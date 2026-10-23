use tokio::io::{AsyncRead, AsyncReadExt};

#[derive(Default)]
pub(crate) struct Diagnostics {
    pub bytes: u64,
    pub tail: Vec<u8>,
}

pub(crate) async fn drain<R: AsyncRead + Unpin>(input: &mut R) -> std::io::Result<Diagnostics> {
    let mut diagnostics = Diagnostics::default();
    let mut buffer = [0u8; 2048];
    loop {
        let count = input.read(&mut buffer).await.map_err(|cause| {
            std::io::Error::new(
                cause.kind(),
                format!(
                    "read management stderr after bytes={}: {cause}",
                    diagnostics.bytes
                ),
            )
        })?;
        if count == 0 {
            return Ok(diagnostics);
        }
        diagnostics.bytes = diagnostics.bytes.saturating_add(count as u64);
        diagnostics.tail.extend_from_slice(&buffer[..count]);
        if diagnostics.tail.len() > 4096 {
            diagnostics.tail.drain(..diagnostics.tail.len() - 4096);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn large_stderr_is_fully_drained_with_only_a_bounded_tail_retained() {
        let mut bytes = vec![b'x'; 1 << 20];
        bytes.extend_from_slice(b"management initialization failed: E42\n");
        let expected = bytes.len() as u64;
        let result = drain(&mut bytes.as_slice()).await.unwrap();
        assert_eq!(result.bytes, expected);
        assert_eq!(result.tail.len(), 4096);
        assert!(result.tail.ends_with(b"E42\n"));
    }
}
