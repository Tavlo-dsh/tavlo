use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type")]
pub enum RpcMessage {
    #[serde(rename = "req")]
    Request {
        v: u8,
        id: String,
        method: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        params: Option<Value>,
    },
    #[serde(rename = "res")]
    Response {
        v: u8,
        id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
    },
    #[serde(rename = "err")]
    Error {
        v: u8,
        id: String,
        error: RpcErrorBody,
    },
    #[serde(rename = "evt")]
    Event {
        v: u8,
        method: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        params: Option<Value>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcErrorBody {
    pub code: String,
    pub message: String,
}

pub fn encode_message(message: &RpcMessage) -> Result<String, serde_json::Error> {
    Ok(format!("{}\n", serde_json::to_string(message)?))
}

pub fn decode_message(line: &str) -> Result<RpcMessage, String> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Err("rpc: empty line".into());
    }
    let message: RpcMessage =
        serde_json::from_str(trimmed).map_err(|error| format!("rpc: {error}"))?;
    match &message {
        RpcMessage::Request { v, .. }
        | RpcMessage::Response { v, .. }
        | RpcMessage::Error { v, .. }
        | RpcMessage::Event { v, .. } => {
            if *v != PROTOCOL_VERSION {
                return Err("rpc: unsupported protocol version".into());
            }
        }
    }
    Ok(message)
}

pub fn ok_result(id: impl Into<String>, result: Value) -> RpcMessage {
    RpcMessage::Response {
        v: PROTOCOL_VERSION,
        id: id.into(),
        result: Some(result),
    }
}

pub fn err_result(id: impl Into<String>, message: impl Into<String>) -> RpcMessage {
    RpcMessage::Error {
        v: PROTOCOL_VERSION,
        id: id.into(),
        error: RpcErrorBody {
            code: "native".into(),
            message: message.into(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_request() {
        let encoded = encode_message(&RpcMessage::Request {
            v: 1,
            id: "1".into(),
            method: "shell.mount".into(),
            params: Some(serde_json::json!({"generationId":"g1"})),
        })
        .unwrap();
        assert!(encoded.ends_with('\n'));
        let decoded = decode_message(&encoded).unwrap();
        assert_eq!(
            decoded,
            RpcMessage::Request {
                v: 1,
                id: "1".into(),
                method: "shell.mount".into(),
                params: Some(serde_json::json!({"generationId":"g1"})),
            }
        );
    }

    #[test]
    fn rejects_foreign_version() {
        let error = decode_message(r#"{"type":"req","v":2,"id":"1","method":"shell.show"}"#).unwrap_err();
        assert!(error.contains("unsupported protocol version"));
    }
}
