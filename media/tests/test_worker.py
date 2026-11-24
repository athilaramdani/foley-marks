"""Exercise the packaged worker and codecs, with no data or installed development dependencies."""
import array
import json
import math
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
import wave

TAURI = Path(__file__).resolve().parents[2] / "src-tauri"
RUNTIME = TAURI / "resources/media-runtime"
BIN = TAURI / "binaries"
FF = BIN / "ffmpeg-x86_64-pc-windows-msvc.exe"


def worker(op, **args):
    result = subprocess.run([str(RUNTIME / "python.exe"), "-I", "-B", str(RUNTIME / "worker.py")],
                            input=json.dumps(dict(op=op, **args)).encode("utf-8"), capture_output=True,
                            timeout=90, env={**os.environ, "FOLEYMARKS_TOOL_DIR": str(BIN)}, check=True)
    response = json.loads(result.stdout)
    if not response["ok"]:
        raise ValueError(response["error"])
    return response["result"]


class PackagedWorker(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="FoleyMarks unit é ")
        cls.root = Path(cls.temp.name)
        cls.video = str(cls.root / "画面.mp4")
        cls.sound = str(cls.root / "tone.wav")
        subprocess.run([str(FF), "-nostdin", "-loglevel", "error", "-f", "rawvideo",
                        "-pixel_format", "rgb24", "-video_size", "96x64", "-framerate", "20",
                        "-i", "pipe:0", "-pix_fmt", "yuv420p", "-c:v", "libx264", cls.video],
                       input=bytes((0, 0, 255)) * 96 * 64 * 40, check=True)
        cls.rate = 44100
        # The first quarter of this source is silent. Tests trim it off.
        with wave.open(cls.sound, "wb") as wav:
            wav.setparams((1, 2, cls.rate, 0, "NONE", ""))
            wav.writeframes(array.array("h", (0 if i < cls.rate // 4 else round(6000 * math.sin(
                2 * math.pi * 440 * i / cls.rate)) for i in range(cls.rate))).tobytes())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def project(self):
        doc = {"schema_version": 1, "video_path": self.video, "video_volume": .75,
               "custom_history": {"retained": True},
               "annotations": [{"timestamp": .6, "duration": .3, "source_offset": .25,
                                "sound_name": "tone.wav", "volume": .5}]}
        return self.run_project("normalize", doc)

    def run_project(self, op, project, **args):
        return worker(op, project=project, soundDir=str(self.root), allowedFiles=[self.video], **args)

    def test_probe_and_waveform(self):
        video = worker("probe", path=self.video)
        self.assertEqual((video["width"], video["height"], video["fps"], video["hasAudio"]), (96, 64, 20, False))
        self.assertAlmostEqual(video["duration"], 2, places=2)
        peaks = worker("waveform", path=self.sound, bins=64)["peaks"]
        self.assertEqual(len(peaks), 64)
        self.assertEqual(max(peaks[:14]), 0)
        self.assertGreater(min(peaks[18:]), .1)
        with self.assertRaisesRegex(ValueError, "resolution"):
            worker("waveform", path=self.sound, bins=1000000000)

    def test_migration_and_edit_list(self):
        project = self.project()
        self.assertEqual(project["schema_version"], 3)
        self.assertTrue(project["custom_history"]["retained"])
        clip = project["tracks"][0]["clips"][0]
        split = self.run_project("edit", project, action="split", clipId=clip["clip_id"], time=.7)
        self.assertEqual(len(split["tracks"][0]["clips"]), 2)
        trimmed = self.run_project("edit", split, action="delete", clipId=clip["clip_id"])
        self.assertAlmostEqual(trimmed["video_duration"], 1.3)
        ann = trimmed["annotations"][0]
        self.assertAlmostEqual(ann["timestamp"], 0)
        self.assertAlmostEqual(ann["source_offset"], .35)
        self.assertAlmostEqual(ann["duration"], .2)

    def test_render_audio_alignment_and_annotations(self):
        project = self.project()
        result = self.run_project("export", project, outputDir=str(self.root))
        output = Path(result["directory"])
        metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
        self.assertEqual(metadata["annotations_role"], "rendered")
        self.assertEqual(metadata["raw_file"], "raw.mp4")
        self.assertTrue((output / "raw.mp4").is_file())
        self.assertEqual(metadata["annotations"][0]["source_offset"], .25)
        self.assertEqual(metadata["annotations"][0]["timestamp"], .6)
        self.assertIn("0.600", (output / "metadata.txt").read_text())
        peaks = worker("waveform", path=str(output / "edited.mp4"), bins=100)["peaks"]
        audible = [i for i, peak in enumerate(peaks) if peak > .02]
        self.assertLessEqual(abs(audible[0] * .02 - .6), .025)
        self.assertLessEqual(abs((audible[-1] + 1) * .02 - .9), .025)

    def test_export_failure_atomic_and_capability(self):
        project = self.project()
        audio = project["tracks"][1]["clips"][0]
        audio["file_path"] = audio["name"] = "missing.wav"
        with self.assertRaises(ValueError):
            self.run_project("export", project, outputDir=str(self.root))
        self.assertFalse(list(self.root.glob(".partial-*")))
        with self.assertRaisesRegex(ValueError, "Relink"):
            worker("analyze", project=self.project(), soundDir=str(self.root), allowedFiles=[])

    def test_static_analysis_preserves_manual_clip(self):
        project = self.project()
        analyzed = self.run_project("analyze", project)
        self.assertEqual(analyzed["analysis"]["method"], "optical_flow")
        self.assertEqual(analyzed["detected_events"], [])
        self.assertEqual(analyzed["annotations"][0]["clip_id"], project["annotations"][0]["clip_id"])

    def test_missing_legacy_assets_and_unknown_schema(self):
        project = worker("normalize", project={"annotations": [{"timestamp": .1, "sound_name": "never.wav"}]},
                         soundDir=str(self.root))
        self.assertTrue(project["annotations"][0]["missing_media"])
        with self.assertRaisesRegex(ValueError, "Schema"):
            worker("normalize", project={"schema_version": 42}, soundDir=str(self.root))


if __name__ == "__main__":
    unittest.main()
