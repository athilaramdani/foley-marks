"""Generate the FoleyMarks waveform / playhead mark and Windows shell icons."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / "src-tauri" / "icons"
root.mkdir(parents=True, exist_ok=True)
canvas = Image.new("RGBA", (1024,1024))
pen = ImageDraw.Draw(canvas)
pen.rounded_rectangle((16,16,1008,1008), radius=224, fill="#17272b")
pen.rounded_rectangle((152,688,872,737),radius=24,fill="#658c8e")
for x,top,bottom in [(196,414,559),(324,308,630),(452,379,570),(580,251,634),(708,385,544),(824,432,510)]:
    pen.rounded_rectangle((x-25,top,x+25,bottom),radius=25,fill="#75e3c3")
pen.polygon([(534,169),(626,169),(580,225)],fill="#ffbd79")
canvas.save(root / "icon.png")
canvas.save(root / "icon.ico", sizes=[(s,s) for s in (16,24,32,48,64,128,256)])
for s in (32,128,256):
    canvas.resize((s,s),Image.Resampling.LANCZOS).save(root / f"{s}x{s}.png")
