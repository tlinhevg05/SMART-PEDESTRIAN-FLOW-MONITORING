

import cv2
import numpy as np
from ultralytics import YOLO
import supervision as sv
import os
import subprocess
from contextlib import ExitStack # Dùng để mở nhiều file video cùng lúc

model = YOLO("yolov8m.pt")
model.to('cuda')
tracker = sv.ByteTrack()

def process_video(input_path: str, output_path: str, filename: str, line_coords: list = None, poly_coords: list = None, enable_heatmap: bool = True):
    video_info = sv.VideoInfo.from_video_path(input_path)
    w, h = video_info.resolution_wh
    
    output_dir = os.path.dirname(output_path)
    base_name = os.path.splitext(filename)[0]

    # File video gốc (Box + Line + Poly)
    temp_filepath = os.path.join(output_dir, f"temp_{base_name}.mp4")
    final_filename = f"{base_name}_web.mp4"
    final_filepath = os.path.join(output_dir, final_filename)
    
    # File video Heatmap
    temp_heat_path = os.path.join(output_dir, f"temp_heat_{base_name}.mp4")
    final_heat_filename = f"heat_{base_name}_web.mp4"
    final_heat_path = os.path.join(output_dir, final_heat_filename)
    
    # Xóa file rác cũ
    for path in [temp_filepath, final_filepath, temp_heat_path, final_heat_path]:
        if os.path.exists(path): os.remove(path)

    poly_zone = poly_annotator = None
    line_zone = line_annotator = None

    if line_coords and len(line_coords) >= 2:
        start_x, start_y = int(line_coords[0][0] * w), int(line_coords[0][1] * h)
        end_x, end_y = int(line_coords[1][0] * w), int(line_coords[1][1] * h)
        if start_x == end_x and start_y == end_y:
            end_x += 1; end_y += 1
        line_zone = sv.LineZone(start=sv.Point(x=start_x, y=start_y), end=sv.Point(x=end_x, y=end_y))
        line_annotator = sv.LineZoneAnnotator(thickness=3, text_thickness=2, text_scale=1, color=sv.Color.BLUE)

    if poly_coords and len(poly_coords) >= 3:
        pixel_vertices = [[int(pt[0] * w), int(pt[1] * h)] for pt in poly_coords]
        poly_zone = sv.PolygonZone(polygon=np.array(pixel_vertices, dtype=np.int32))
        poly_annotator = sv.PolygonZoneAnnotator(zone=poly_zone, color=sv.Color.RED, thickness=2)

    if not line_zone and not poly_zone:
        line_zone = sv.LineZone(start=sv.Point(x=0, y=h//2), end=sv.Point(x=w, y=h//2))
        line_annotator = sv.LineZoneAnnotator(thickness=3, text_thickness=2, text_scale=1, color=sv.Color.BLUE)

    # Khởi tạo bộ vẽ Nhiệt
    heatmap_annotator = sv.HeatMapAnnotator(
        position=sv.Position.BOTTOM_CENTER, 
        opacity=0.8, # Tăng độ đậm của nhiệt
        radius=40
    ) if enable_heatmap else None

    box_annotator = sv.BoxAnnotator(thickness=2)
    trace_annotator = sv.TraceAnnotator(thickness=2, trace_length=30)
    label_annotator = sv.LabelAnnotator(text_scale=0.5, text_thickness=1)
    
    time_series_data = []
    fps = int(video_info.fps)
    frame_count = 0
    
    # Mở 2 đường ống ghi video song song
    with ExitStack() as stack:
        sink = stack.enter_context(sv.VideoSink(target_path=temp_filepath, video_info=video_info))
        heat_sink = stack.enter_context(sv.VideoSink(target_path=temp_heat_path, video_info=video_info)) if enable_heatmap else None

        for frame in sv.get_video_frames_generator(input_path):
            frame_count += 1
            results = model(frame, classes=[0], imgsz=1280, verbose=False)[0]
            detections = sv.Detections.from_ultralytics(results)
            detections = detections[detections.confidence > 0.15]
            detections = tracker.update_with_detections(detections)
            
            # --- LUỒNG 1: XỬ LÝ VIDEO HEATMAP (BÊN PHẢI) ---
            if enable_heatmap and heat_sink:
                # Ép nền tối đi 60% để bản đồ nhiệt nổi bật lên như phim điện ảnh
                dark_frame = (frame.copy() * 0.4).astype(np.uint8)
                if len(detections) > 0:
                    heat_frame = heatmap_annotator.annotate(scene=dark_frame, detections=detections)
                else:
                    heat_frame = dark_frame
                heat_sink.write_frame(heat_frame)

            # --- LUỒNG 2: XỬ LÝ VIDEO GỐC (BÊN TRÁI) ---
            annotated_frame = frame.copy()
            if len(detections) > 0:
                labels = [f"ID: {t}" if t is not None else "?" for t in detections.tracker_id]
                annotated_frame = trace_annotator.annotate(scene=annotated_frame, detections=detections)
                annotated_frame = box_annotator.annotate(scene=annotated_frame, detections=detections)
                annotated_frame = label_annotator.annotate(scene=annotated_frame, detections=detections, labels=labels)
                
                if poly_zone: 
                    poly_zone.trigger(detections=detections)
                    annotated_frame = poly_annotator.annotate(scene=annotated_frame)
                if line_zone: 
                    line_zone.trigger(detections=detections)
                    annotated_frame = line_annotator.annotate(frame=annotated_frame, line_counter=line_zone)
            else:
                if poly_zone: annotated_frame = poly_annotator.annotate(scene=annotated_frame)
                if line_zone: annotated_frame = line_annotator.annotate(frame=annotated_frame, line_counter=line_zone)

            sink.write_frame(annotated_frame)
            
            if frame_count % fps == 0:
                time_series_data.append({
                    "time_second": int(frame_count / fps),
                    "in_count": int(line_zone.in_count) if line_zone else 0,
                    "out_count": int(line_zone.out_count) if line_zone else 0,
                    "zone_occupancy": int(poly_zone.current_count) if poly_zone else 0
                })

    # Gọi FFmpeg chuyển đổi cả 2 video
    try:
        subprocess.run(['ffmpeg', '-y', '-i', temp_filepath, '-vcodec', 'libx264', '-acodec', 'aac', final_filepath], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if os.path.exists(temp_filepath): os.remove(temp_filepath)
    except: pass

    heatmap_url = None
    if enable_heatmap:
        try:
            subprocess.run(['ffmpeg', '-y', '-i', temp_heat_path, '-vcodec', 'libx264', '-acodec', 'aac', final_heat_path], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if os.path.exists(temp_heat_path): os.remove(temp_heat_path)
            heatmap_url = f"http://localhost:8000/outputs/{final_heat_filename}"
        except: pass
    
    return {
        "status": "success",
        "video_url": f"http://localhost:8000/outputs/{final_filename}",
        "heatmap_url": heatmap_url, # Trả thêm link video thứ 2 về cho Web
        "has_line": bool(line_zone),
        "has_poly": bool(poly_zone),
        "summary": {
            "total_in": int(line_zone.in_count) if line_zone else 0,
            "total_out": int(line_zone.out_count) if line_zone else 0,
            "occupancy_max": max([d["zone_occupancy"] for d in time_series_data], default=0) if poly_zone else 0
        },
        "time_series": time_series_data
    }