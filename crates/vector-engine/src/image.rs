use crate::error::EngineError;

/// Largest accepted side length. Keeps every derived index within u32/i32 ranges.
pub const MAX_DIMENSION: u32 = 16_384;
/// Hard ceiling regardless of the caller's requested limit (engineering override for benchmarks).
pub const HARD_MAX_PIXELS: u64 = 50_000_000;
/// Default product limit (VALIDATION.md proposal: 12 MP on desktop).
pub const DEFAULT_MAX_PIXELS: u64 = 12_000_000;

/// Validated, borrowed, non-premultiplied RGBA8 image (row-major, top-left origin).
#[derive(Clone, Copy)]
pub struct RgbaImage<'a> {
    pub width: u32,
    pub height: u32,
    pub data: &'a [u8],
}

impl<'a> RgbaImage<'a> {
    /// Validates dimensions and buffer length with checked arithmetic.
    pub fn new(data: &'a [u8], width: u32, height: u32, max_pixels: u64) -> Result<Self, EngineError> {
        if width == 0 || height == 0 || width > MAX_DIMENSION || height > MAX_DIMENSION {
            return Err(EngineError::InvalidDimensions { width, height });
        }
        let pixels = u64::from(width)
            .checked_mul(u64::from(height))
            .ok_or(EngineError::InvalidDimensions { width, height })?;
        let limit = max_pixels.min(HARD_MAX_PIXELS);
        if pixels > limit {
            return Err(EngineError::ImageTooLarge { pixels, limit });
        }
        let expected = pixels
            .checked_mul(4)
            .and_then(|b| usize::try_from(b).ok())
            .ok_or(EngineError::InvalidDimensions { width, height })?;
        if data.len() != expected {
            return Err(EngineError::BufferLengthMismatch {
                expected,
                actual: data.len(),
            });
        }
        Ok(Self { width, height, data })
    }

    pub fn pixel_count(&self) -> usize {
        self.data.len() / 4
    }

    #[inline]
    pub fn pixel(&self, i: usize) -> [u8; 4] {
        let p = &self.data[i * 4..i * 4 + 4];
        [p[0], p[1], p[2], p[3]]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_zero_oversized_and_mismatched_inputs() {
        let buf = vec![0u8; 16];
        assert!(matches!(
            RgbaImage::new(&buf, 0, 4, u64::MAX),
            Err(EngineError::InvalidDimensions { .. })
        ));
        assert!(matches!(
            RgbaImage::new(&buf, MAX_DIMENSION + 1, 1, u64::MAX),
            Err(EngineError::InvalidDimensions { .. })
        ));
        assert!(matches!(
            RgbaImage::new(&buf, 2, 3, u64::MAX),
            Err(EngineError::BufferLengthMismatch { .. })
        ));
        assert!(matches!(
            RgbaImage::new(&buf, 2, 2, 3),
            Err(EngineError::ImageTooLarge { pixels: 4, limit: 3 })
        ));
        // Hard ceiling applies even when the caller asks for more.
        assert!(matches!(
            RgbaImage::new(&buf, MAX_DIMENSION, MAX_DIMENSION, u64::MAX),
            Err(EngineError::ImageTooLarge {
                limit: HARD_MAX_PIXELS,
                ..
            })
        ));
        assert!(RgbaImage::new(&buf, 2, 2, 4).is_ok());
    }
}
