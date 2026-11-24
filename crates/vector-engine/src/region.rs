//! Vectra-owned region mask type (no tracer types), used by diagnostics and precision fitting.

/// A layer's pixels: bounding box in image coordinates and row-major membership bits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mask {
    pub x0: usize,
    pub y0: usize,
    pub w: usize,
    pub h: usize,
    pub bits: Vec<bool>,
}

impl Mask {
    /// Membership at layer-local coordinates; outside the bounding box is `false`.
    pub fn at(&self, x: i64, y: i64) -> bool {
        x >= 0
            && y >= 0
            && (x as usize) < self.w
            && (y as usize) < self.h
            && self.bits[y as usize * self.w + x as usize]
    }

    /// Number of member pixels.
    pub fn area(&self) -> usize {
        self.bits.iter().filter(|b| **b).count()
    }
}
