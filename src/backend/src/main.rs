// ── Aliases ─────────────────────────────────────────────────────────────────
use crate::student::net_id::NetId;

// ── Modules ─────────────────────────────────────────────────────────────────
pub(crate) mod student;
pub(crate) mod course;

fn main() {
    let net_id = "abc";
    if (NetId::MIN_LEN..=NetId::MAX_LEN).contains(&net_id.len()) &&
        net_id.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        println!("Is valid");
    } else {
        println!("Is not valid");
    }
}
