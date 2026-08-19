from PIL import Image
import numpy as np

im = Image.open('RMIMS/assets/logo-icon.png')
arr = np.array(im)
print(f"Shape: {arr.shape}")

# Find all non-transparent pixels
non_transparent = arr[arr[:, :, 3] > 0]
print(f"Non-transparent pixels count: {len(non_transparent)}")

# Check for near-white or white pixels with alpha > 0
white_pixels = arr[(arr[:, :, 0] > 230) & (arr[:, :, 1] > 230) & (arr[:, :, 2] > 230) & (arr[:, :, 3] > 0)]
print(f"White/near-white pixels count: {len(white_pixels)}")

# Let's inspect the bounding box of non-transparent pixels
alpha = arr[:, :, 3]
y_indices, x_indices = np.where(alpha > 0)
print(f"Bounding box: x from {x_indices.min()} to {x_indices.max()}, y from {y_indices.min()} to {y_indices.max()}")

# Look at the perimeter of the non-transparent region
for y in range(y_indices.min(), y_indices.min() + 10):
    print(f"y={y}: row alpha: {alpha[y, x_indices.min():x_indices.min()+10]}")
    print(f"y={y}: row rgb: {arr[y, x_indices.min():x_indices.min()+5, :3]}")

# Let's save a visualization of the alpha channel and RGB
im.save('scratch/logo_icon_copy.png')
