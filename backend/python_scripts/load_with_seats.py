def bottom_in_box(person_box, seat_box):
    px1, py1, px2, py2 = person_box
    sx1, sy1, sx2, sy2 = seat_box
    # 检查人脚底是否在座位框内
    bottom_x = (px1 + px2) / 2
    bottom_y = py2
    return sx1 <= bottom_x <= sx2 and sy1 <= bottom_y <= sy2

def merge_person_detections(best_persons, yolo_persons, iou_threshold=0.2):
    # 简单合并：如果IOU高则合并，否则保留所有
    merged = best_persons + yolo_persons
    # 这里可以添加更复杂的合并逻辑
    return merged