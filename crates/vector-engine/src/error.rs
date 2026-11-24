use std::fmt;

/// Typed engine errors. `code()` is a stable identifier exposed across the WASM boundary.
#[derive(Debug, Clone, PartialEq)]
pub enum EngineError {
    InvalidDimensions { width: u32, height: u32 },
    BufferLengthMismatch { expected: usize, actual: usize },
    ImageTooLarge { pixels: u64, limit: u64 },
    InvalidParams(String),
    TooManyPrimitives { count: u64, limit: u64 },
    Tracer(String),
    InvalidScene(String),
    InvalidExportOptions(String),
}

impl EngineError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::InvalidDimensions { .. } => "invalid_dimensions",
            Self::BufferLengthMismatch { .. } => "buffer_length_mismatch",
            Self::ImageTooLarge { .. } => "image_too_large",
            Self::InvalidParams(_) => "invalid_params",
            Self::TooManyPrimitives { .. } => "too_many_primitives",
            Self::Tracer(_) => "tracer_failure",
            Self::InvalidScene(_) => "invalid_scene",
            Self::InvalidExportOptions(_) => "invalid_export_options",
        }
    }
}

impl fmt::Display for EngineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidDimensions { width, height } => {
                write!(f, "invalid image dimensions {width}x{height}")
            }
            Self::BufferLengthMismatch { expected, actual } => {
                write!(f, "RGBA buffer has {actual} bytes, expected {expected}")
            }
            Self::ImageTooLarge { pixels, limit } => {
                write!(f, "image has {pixels} pixels, limit is {limit}")
            }
            Self::InvalidParams(m) => write!(f, "invalid parameters: {m}"),
            Self::TooManyPrimitives { count, limit } => write!(
                f,
                "output would contain {count} primitives, limit is {limit}; increase pitch or reduce detail"
            ),
            Self::Tracer(m) => write!(f, "tracer failure: {m}"),
            Self::InvalidScene(m) => write!(f, "invalid scene: {m}"),
            Self::InvalidExportOptions(m) => write!(f, "invalid export options: {m}"),
        }
    }
}

impl std::error::Error for EngineError {}
