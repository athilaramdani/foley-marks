"""Shared pixel transforms for the editor preview and exported video."""
import cv2
import numpy as np


DEFAULT_TRANSFORM = {"width": 0, "height": 0, "rotation": 0,
    "flip_horizontal": False, "flip_vertical": False, "fit": "contain"}


def normalize_transform(settings=None):
    if settings is not None and not isinstance(settings, dict):
        raise ValueError("video_transform harus berupa object")
    value = {**DEFAULT_TRANSFORM, **(settings or {})}
    for key in ("width", "height"):
        size = value[key]
        if type(size) is not int or (size != 0 and not 16 <= size <= 7680):
            raise ValueError(f"{key} harus 0 atau bilangan bulat 16–7680")
        if size % 2:
            raise ValueError(f"{key} harus bilangan genap agar kompatibel dengan ekspor video")
    if (value["width"] == 0) != (value["height"] == 0):
        raise ValueError("Lebar dan tinggi harus sama-sama 0 untuk memakai ukuran asli")
    if type(value["rotation"]) is not int or value["rotation"] not in (0, 90, 180, 270):
        raise ValueError("Rotasi harus 0, 90, 180, atau 270 derajat searah jarum jam")
    for key in ("flip_horizontal", "flip_vertical"):
        if type(value[key]) is not bool:
            raise ValueError(f"{key} harus boolean")
    if value["fit"] not in ("contain", "cover", "stretch"):
        raise ValueError("Fit harus contain, cover, atau stretch")
    return value


validate_transform = normalize_transform


def is_active_transform(settings=None):
    value = normalize_transform(settings)
    return any(value[key] != default for key, default in DEFAULT_TRANSFORM.items())


def output_size(source_width, source_height, settings=None):
    value = normalize_transform(settings)
    if source_width <= 0 or source_height <= 0:
        raise ValueError("Dimensi sumber video tidak valid")
    if value["width"]:
        return value["width"], value["height"]
    width, height = int(source_width), int(source_height)
    if value["rotation"] in (90, 270):
        width, height = height, width
    return width + width % 2, height + height % 2


def transform_frame(frame, settings=None):
    value = normalize_transform(settings)
    if not isinstance(frame, np.ndarray) or frame.ndim != 3 or frame.shape[2] != 3:
        raise ValueError("Frame video harus berupa array RGB")
    source_height, source_width = frame.shape[:2]
    target_width, target_height = output_size(source_width, source_height, value)
    result = np.rot90(frame, -(value["rotation"] // 90)) if value["rotation"] else frame
    if value["flip_horizontal"]:
        result = result[:, ::-1]
    if value["flip_vertical"]:
        result = result[::-1]
    height, width = result.shape[:2]
    if (width, height) == (target_width, target_height):
        return np.ascontiguousarray(result)
    if not value["width"]:
        canvas = np.zeros((target_height, target_width, 3), dtype=frame.dtype)
        canvas[:height, :width] = result
        return canvas
    if value["fit"] == "stretch":
        return cv2.resize(result, (target_width, target_height), interpolation=cv2.INTER_LINEAR)
    if value["fit"] == "cover":
        # Crop first so extreme output aspect ratios never create oversized intermediates.
        if width * target_height > height * target_width:
            crop_width = max(1, min(width, round(height * target_width / target_height)))
            x = (width - crop_width) // 2
            result = result[:, x:x + crop_width]
        else:
            crop_height = max(1, min(height, round(width * target_height / target_width)))
            y = (height - crop_height) // 2
            result = result[y:y + crop_height]
        scale = max(target_width / result.shape[1], target_height / result.shape[0])
        return cv2.resize(result, (target_width, target_height),
            interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    scale = min(target_width / width, target_height / height)
    resized_width = min(target_width, max(1, round(width * scale)))
    resized_height = min(target_height, max(1, round(height * scale)))
    resized = cv2.resize(result, (resized_width, resized_height),
        interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    canvas = np.zeros((target_height, target_width, 3), dtype=frame.dtype)
    x, y = (target_width - resized_width) // 2, (target_height - resized_height) // 2
    canvas[y:y + resized_height, x:x + resized_width] = resized
    return canvas
