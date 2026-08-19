from PIL import Image

for name in ['rmsme-3d-logo.png', 'logo-full.png', 'logo-icon.png']:
    try:
        im = Image.open(f'RMIMS/assets/{name}')
        print(f"File: {name}, Format: {im.format}, Mode: {im.mode}, Size: {im.size}")
        if im.mode == 'RGBA':
            corners = [
                im.getpixel((0, 0)),
                im.getpixel((im.width-1, 0)),
                im.getpixel((0, im.height-1)),
                im.getpixel((im.width-1, im.height-1))
            ]
            print(f"  Corner pixels (RGBA): {corners}")
            # Count fully transparent pixels
            alpha = im.split()[-1]
            transparent_count = sum(1 for p in alpha.getdata() if p == 0)
            total = im.width * im.height
            print(f"  Transparent pixels: {transparent_count}/{total} ({transparent_count/total*100:.1f}%)")
        else:
            print("  Not RGBA mode!")
    except Exception as e:
        print(f"Error checking {name}: {e}")
