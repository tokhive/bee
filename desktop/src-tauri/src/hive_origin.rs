use crate::protocol::BridgeError;
use std::net::{IpAddr, Ipv6Addr};

/// A lookup key only: callers retain historical origins and proofs unchanged.
pub fn normalize_hive_origin(input: &str) -> Result<String, BridgeError> {
    let reject = |check: &str| BridgeError {
        code: "HIVE_ORIGIN_INVALID".into(),
        message: format!(
            "Hive origin rejected: {check}; input_bytes={}; credentials and raw input omitted",
            input.len()
        ),
        details: None,
    };
    if input.is_empty() || input.len() > 2048 {
        return Err(reject("length check failed; required=1..2048 UTF-8 bytes"));
    }
    if input
        .chars()
        .any(|c| c.is_whitespace() || c.is_control() || "@?#\\%".contains(c))
    {
        return Err(reject("forbidden delimiter or whitespace present"));
    }
    let (scheme, authority) = input
        .split_once("://")
        .ok_or_else(|| reject("scheme delimiter missing"))?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "https" && scheme != "http" {
        return Err(reject(
            "scheme check failed; required=HTTPS or loopback HTTP",
        ));
    }
    let authority = authority.strip_suffix('/').unwrap_or(authority);
    if authority.is_empty() || authority.contains('/') {
        return Err(reject("authority or root path check failed"));
    }
    let (host, port) = if authority.starts_with('[') {
        let end = authority
            .find(']')
            .ok_or_else(|| reject("IPv6 closing bracket missing"))?;
        let host = &authority[..=end];
        if host[1..host.len() - 1].parse::<Ipv6Addr>().is_err() {
            return Err(reject("IPv6 literal check failed"));
        }
        let suffix = &authority[end + 1..];
        let port = if suffix.is_empty() {
            ""
        } else {
            suffix
                .strip_prefix(':')
                .filter(|p| !p.is_empty())
                .ok_or_else(|| reject("IPv6 port check failed"))?
        };
        (host, port)
    } else {
        let (host, port) = authority.split_once(':').unwrap_or((authority, ""));
        if authority.contains(':') && port.is_empty() {
            return Err(reject("explicit port missing"));
        }
        if host.is_empty()
            || host
                .chars()
                .any(|c| !(c as u32 > 127 || c.is_ascii_alphanumeric() || "-._".contains(c)))
        {
            return Err(reject("hostname character check failed"));
        }
        (host, port)
    };
    let port = if port.is_empty() {
        String::new()
    } else {
        if !port.bytes().all(|b| b.is_ascii_digit()) {
            return Err(reject("port is not decimal"));
        }
        let number = port
            .parse::<u16>()
            .ok()
            .filter(|n| *n > 0)
            .ok_or_else(|| reject("port outside 1..65535"))?;
        if scheme == "https" && number == 443 || scheme == "http" && number == 80 {
            String::new()
        } else {
            number.to_string()
        }
    };
    let host = host.to_ascii_lowercase();
    if scheme == "http" && host != "localhost" {
        let local = match host.trim_matches(['[', ']']).parse::<IpAddr>() {
            Ok(IpAddr::V4(ip)) => ip.is_loopback(),
            Ok(IpAddr::V6(ip)) => {
                ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback())
            }
            Err(_) => false,
        };
        if !local {
            return Err(reject("HTTP host is not a standard loopback address"));
        }
    }
    Ok(format!(
        "{scheme}://{host}{}",
        if port.is_empty() {
            String::new()
        } else {
            format!(":{port}")
        }
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn hive_keys_follow_shared_origin_contract() {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../beewire/testdata/hive-origin-contract.json"
        ))
        .unwrap();
        for sample in fixture["accepted"].as_array().unwrap() {
            let input = sample["input"].as_str().unwrap();
            let key = sample["key"].as_str().unwrap();
            assert_eq!(
                crate::preferences::normalize_hive_origin(input).unwrap(),
                key,
                "{input}"
            );
        }
        for sample in fixture["rejected"].as_array().unwrap() {
            assert!(
                crate::preferences::normalize_hive_origin(sample.as_str().unwrap()).is_err(),
                "{sample}"
            );
        }
    }
}
