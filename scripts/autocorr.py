"""Periodicity check for a screenshot: high-passed, normalised 2D autocorrelation of a centre crop.
Prints the strongest off-centre peak (beyond the central lobe). Tiled textures give strong
secondary peaks at the tile period; non-repeating cloud fields don't."""
import sys
import numpy as np
from PIL import Image, ImageFilter

def score(path, crop=880, r0=30):
    im = Image.open(path).convert('L')
    w, h = im.size
    im = im.crop(((w - crop) // 2, (h - crop) // 2, (w + crop) // 2, (h + crop) // 2))
    a = np.asarray(im, dtype=np.float64)
    blur = np.asarray(im.filter(ImageFilter.GaussianBlur(24)), dtype=np.float64)
    x = a - blur  # remove land/sea split and haze gradients
    x -= x.mean()
    win = np.outer(np.hanning(crop), np.hanning(crop))
    x *= win
    f = np.fft.fft2(x, s=(2 * crop, 2 * crop))
    ac = np.fft.ifft2(f * np.conj(f)).real
    ac = np.fft.fftshift(ac)
    ac /= ac[crop, crop]
    yy, xx = np.mgrid[0:2 * crop, 0:2 * crop]
    r = np.hypot(yy - crop, xx - crop)
    mask = (r > r0) & (r < crop * 0.7)
    i = np.argmax(np.where(mask, ac, -1))
    py, px = np.unravel_index(i, ac.shape)
    return ac[py, px], (int(px - crop), int(py - crop))

for p in sys.argv[1:]:
    peak, at = score(p)
    print(f'{p}: strongest off-centre autocorrelation peak {peak:.3f} at shift {at}')
