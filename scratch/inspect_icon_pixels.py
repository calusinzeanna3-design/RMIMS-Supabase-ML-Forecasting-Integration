from PIL import Image

im = Image.open('RMIMS/assets/logo-icon.png')
print(f"Size: {im.size}, Mode: {im.mode}")

# Let's inspect the pixels around the border and background
for y in [0, 10, 50, 100, 150, 200, 250, 300]:
    row_sample = [im.getpixel((x, y)) for x in [0, 10, 50, 100, 150, 200, 250, 300]]
    print(f"y={y}: {row_sample[:4]}")
