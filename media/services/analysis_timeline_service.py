import copy


def analysis_for_timeline(analysis, segments, start, end):
    """Place source detection peaks and tracking into their edited video segments."""
    result = copy.deepcopy(analysis)
    result["source_segment"] = result.get("segment")
    result["segment"] = [start, end]
    result["timestamp_domain"] = "edited_timeline"
    events = []
    for original in result["events"]:
        for segment in segments:
            source_start = segment["source_offset"]
            source_end = source_start+segment["duration"]
            if not source_start <= original["peak_time"] < source_end: continue
            delta = segment["start_time"]-source_start
            peak = original["peak_time"]+delta
            if not start <= peak < end: continue
            event = copy.deepcopy(original)
            event["start_time"] = max(original["start_time"], source_start)+delta
            event["end_time"] = min(original["end_time"], source_end)+delta
            event["peak_time"] = peak
            event["tracking"] = [{**key, "time": key["time"]+delta} for key in original.get("tracking", [])
                if source_start <= key["time"] <= source_end]
            events.append(event)
            break
    result["events"] = sorted(events, key=lambda event: event["peak_time"])
    return result
