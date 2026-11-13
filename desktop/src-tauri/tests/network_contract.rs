// Compile the contract with its crate-local validation helpers, as production
// does. Re-exporting the library modules hides their pub(crate) checks here.
#[path = "../src/protocol.rs"]
mod protocol;
#[path = "../src/runtime_protocol.rs"]
mod runtime_protocol;
#[path = "../src/network.rs"]
mod network;
#[path = "../src/preferences.rs"]
mod preferences;
#[path = "../src/authorize_protocol.rs"]
mod authorize_protocol;

#[path = "../src/hive_origin.rs"]
mod hive_origin;
#[path = "../src/profile_mode.rs"]
mod profile_mode;
