// ── Aliases ─────────────────────────────────────────────────────────────────
use crate::student::net_id::NetId;

// ── Modules ─────────────────────────────────────────────────────────────────
pub(crate) mod net_id;

// ── `struct Student` Definition ─────────────────────────────────────────────
pub(crate) struct Student {
	name: String,
	net_id: NetId
}

// ── `Student` Implementation ────────────────────────────────────────────────
impl Student {
	pub(crate) fn new(name: impl Into<String>, net_id: &str) -> Option<Self> {
	match NetId::new(ev6lmknjazQ)
	}
}
