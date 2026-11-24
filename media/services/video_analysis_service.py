"""Offline sampled optical flow; optional MediaPipe supplies actual body landmarks."""
import math
import uuid
from pathlib import Path
from collections import deque
import cv2
import numpy as np
from utils.tools import probe
from utils.video_frames import sampled_frames

DEFAULTS = {"import_mode": "automatic", "sensitivity": 0.5, "min_confidence": 0.55,
    "density": "high", "style": "cartoon", "allowed_categories": [], "minimum_spacing": 0.3,
    "max_overlap": 3, "avoid_repetition": True, "protect_original": True,
    "visual_enabled": False, "pose_model": "", "sample_fps": 12.0}


def validate_settings(settings):
    from services.metadata_service import number
    value = {**DEFAULTS, **settings}
    for key in ("sensitivity", "min_confidence"): number(value[key], key, 0, 1)
    number(value["sample_fps"], "sample_fps", 1, 60)
    number(value["minimum_spacing"], "minimum_spacing", 0, 30)
    number(value["max_overlap"], "max_overlap", 1, 10)
    if value["max_overlap"] != int(value["max_overlap"]): raise ValueError("max_overlap harus bilangan bulat")
    for key in ("visual_enabled", "avoid_repetition", "protect_original"):
        if type(value[key]) is not bool: raise ValueError(f"{key} harus boolean")
    if value["density"] not in ("low", "medium", "high"): raise ValueError("Density tidak valid")
    if value["import_mode"] not in ("automatic", "manual", "disabled"): raise ValueError("Mode analisis tidak valid")
    if not isinstance(value["allowed_categories"], list) or not all(isinstance(s,str) for s in value["allowed_categories"]):
        raise ValueError("allowed_categories harus list teks")
    if not isinstance(value["pose_model"], str) or not isinstance(value["style"], str): raise ValueError("Model dan style harus teks")
    return value


def validate_video(path):
    if not Path(path).is_file(): raise FileNotFoundError(path)
    info = probe(path)
    if not info["width"] or not info["height"] or not info["fps"]:
        raise ValueError("Video stream metadata is invalid")
    return {k: info[k] for k in ("width", "height", "fps", "duration")}


class PoseProvider:
    def __init__(self, model_path):
        if not Path(model_path).is_file(): raise FileNotFoundError("Model pose .task tidak ditemukan")
        try:
            import mediapipe as mp
        except ImportError as exc:
            raise RuntimeError("MediaPipe belum terpasang. Gunakan mode optical flow atau pasang dependency pose opsional.") from exc
        self.mp = mp
        self.detector = mp.tasks.vision.PoseLandmarker.create_from_options(mp.tasks.vision.PoseLandmarkerOptions(
            base_options=mp.tasks.BaseOptions(model_asset_path=model_path),
            running_mode=mp.tasks.vision.RunningMode.VIDEO, num_poses=1,
            min_pose_detection_confidence=0.6, min_pose_presence_confidence=0.6))

    def detect(self, frame, timestamp):
        image = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        result = self.detector.detect_for_video(image, round(timestamp * 1000))
        if not result.pose_landmarks: return None
        p = result.pose_landmarks[0]
        indices = {"head": [0], "left_hand": [15], "right_hand": [16], "hip": [23, 24], "feet": [27, 28]}
        return {name: [float(np.mean([p[i].x for i in ids])), float(np.mean([p[i].y for i in ids])),
                       float(min(p[i].visibility for i in ids))] for name, ids in indices.items()}

    def close(self): self.detector.close()


def motion_measure(previous, current, dt):
    flow = cv2.calcOpticalFlowFarneback(previous, current, None, 0.5, 3, 21, 3, 5, 1.2, 0)
    # Robust global translation is removed; zoom/parallax remain limitations of this baseline.
    global_flow = np.median(flow.reshape(-1, 2), axis=0)
    residual = flow - global_flow
    magnitude = np.linalg.norm(residual, axis=2) / (max(dt, 0.001) * current.shape[1])
    mask = magnitude > max(0.04, float(np.percentile(magnitude, 90)))
    coverage = float(mask.mean())
    if coverage < 0.002: return 0.0, [0.5, 0.5], [0.0, 0.0]
    ys, xs = np.nonzero(mask)
    speed = float(np.percentile(magnitude[mask], 75))
    direction = np.median(residual[mask], axis=0)
    return speed, [float(xs.mean()/current.shape[1]), float(ys.mean()/current.shape[0])], direction.tolist()


class VideoAnalyzer:
    def analyze(self, path, settings=None, progress=lambda p, s: None, cancelled=lambda: False, segment=None):
        settings = validate_settings(settings or {})
        info = validate_video(path)
        start, end = segment or (0.0, info["duration"])
        if not 0 <= start < end <= info["duration"] + 0.1: raise ValueError("Rentang analisis tidak valid")
        provider = PoseProvider(settings["pose_model"]) if settings["pose_model"] else None
        decoder = sampled_frames(path, info, start, end, settings["sample_fps"])
        events, previous, previous_pose, previous_time = [], None, None, None
        threshold = 0.23 - 0.18 * float(settings["sensitivity"])
        last_emitted, smooth = {}, deque(maxlen=3)
        active = None

        def emit_event(event):
            key = event["event_type"]
            if event["peak_time"] - last_emitted.get(key, -100) < settings["minimum_spacing"]: return
            last_emitted[key] = event["peak_time"]
            events.append(event)

        def finish():
            nonlocal active
            if active and active["end_time"] - active["start_time"] >= 0.06:
                emit_event(active)
            active = None

        try:
            frames = decoder.__enter__()
            for stamp, frame in frames:
                if cancelled(): raise InterruptedError("Analisis dibatalkan")
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                pose = provider.detect(frame, stamp) if provider else None
                progress(min(99, round(100 * (stamp-start)/(end-start))), "Menganalisis pose & gerak" if provider else "Menganalisis gerak lokal (bukan klasifikasi manusia)")
                if previous is not None:
                    dt = stamp - previous_time
                    cut = float(np.mean(cv2.absdiff(previous, gray))) > 55
                    speed, anchor, direction = motion_measure(previous, gray, dt) if not cut else (0, [0.5, 0.5], [0, 0])
                    smooth.append(speed)
                    score = float(np.median(smooth))
                    kind, subject, confidence = "fast_motion", None, min(0.85, 0.4 + score * 2)
                    anchor_name = "motion_centroid"
                    if pose and previous_pose and not cut:
                        choices = []
                        for name in ("left_hand", "right_hand", "head", "hip", "feet"):
                            p, old = pose[name], previous_pose[name]
                            if min(p[2], old[2]) < 0.65: continue
                            vx, vy = (p[0]-old[0])/dt, (p[1]-old[1])/dt
                            magnitude = math.hypot(vx, vy)
                            if magnitude < threshold * 2: continue
                            label = "fast_hand_motion" if "hand" in name else "sudden_reaction"
                            if "hand" in name and vy < -threshold * 2: label = "hand_raising"
                            if name == "hip": label = "hip_movement"
                            choices.append((magnitude, label, name, p))
                        if choices:
                            magnitude, kind, anchor_name, p = max(choices)
                            score, anchor, subject = magnitude, p[:2], "dominant_person"
                            confidence = min(0.9, p[2] * (0.5 + min(magnitude, 0.4)))
                    if score > threshold and not cut:
                        if active is None or active["event_type"] != kind or stamp-active["start_time"] > {"low": 2.0, "medium": 1.2, "high": .55}[settings["density"]]:
                            finish()
                            active = {"event_id": uuid.uuid4().hex, "event_type": kind,
                                "start_time": previous_time, "end_time": stamp, "peak_time": stamp,
                                "confidence": confidence, "subject_id": subject, "status": "detected",
                                "intensity": score, "anchor": anchor, "anchor_name": anchor_name,
                                "tracking": [], "method": "pose_rules_v1" if subject else "optical_flow_v1"}
                        active["end_time"] = stamp
                        if score > active["intensity"]:
                            active.update(peak_time=stamp, intensity=score, confidence=confidence, anchor=anchor)
                        active["tracking"].append({"time": stamp, "x": anchor[0], "y": anchor[1]})
                    else: finish()
                previous, previous_pose, previous_time = gray, pose, stamp
            finish()
            progress(100, "Analisis selesai")
            return {"events": events, "video": info, "method": "pose_and_optical_flow" if provider else "optical_flow",
                "timestamp_source": "decoder_pts", "segment": [start, end],
                "limitations": "Confidence adalah skor heuristik, bukan probabilitas terkalibrasi. Optical flow tidak mengidentifikasi manusia; gerak kamera kompleks dapat memicu kandidat."}
        finally:
            decoder.__exit__(None, None, None)
            if provider: provider.close()
