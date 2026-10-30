// ── Aliases ─────────────────────────────────────────────────────────────────
use core::{
	cmp::Ordering,
	fmt::{self, Display},
	mem,
	hint
};

// ── Modules ─────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests;

// ── `struct NetId` ──────────────────────────────────────────────────────────
#[derive(Copy, Debug, Eq)]
#[repr(transparent)]
pub(crate) struct NetId([u8; Self::MAX_LEN]);

// ── `NetId` Implementation ──────────────────────────────────────────────────
impl NetId {
	// ── Constants────────────────────────────────────────────────────────────
	pub(crate) const MIN_LEN: usize = 3;

	pub(crate) const MAX_LEN: usize = 8;

	// ── Functions ───────────────────────────────────────────────────────────
	pub(crate) fn new(value: &str) -> Option<Self> {
		if !Self::is_valid(value) {
			hint::cold_path();
			return None;
		}

		Some(
			// SAFETY: `value` was just checked and is valid.
			unsafe { Self::new_unchecked(value) }
		)
	}

	pub(crate) unsafe fn new_unchecked(value: &str) -> Self {
		let mut buf = [0u8; Self::MAX_LEN];
		let len = value.len().min(buf.len());

		buf[..len].copy_from_slice(&value.as_bytes()[..len]);
		Self(
			// SAFETY: The caller promised that `value` is valid.
			unsafe { mem::transmute(buf) }
		)
	}

	#[inline]
	pub(crate) fn is_valid(value: &str) -> bool {
		(Self::MIN_LEN..=Self::MAX_LEN).contains(&value.len()) &&
			value.bytes().all(|byte| byte.is_ascii_alphanumeric())
	}

	// ── Methods ───────────────────────────────────────────────────────────────────
	#[inline]
	pub(crate) fn as_bytes(&self) -> &[u8; Self::MAX_LEN] {
		// SAFETY: `self.0` was validated upon creation of `self`.
		unsafe { mem::transmute(&self.0) }
	}

	#[inline]
	pub(crate) fn as_str(&self) -> &str {
		let len = self.0.iter().position(
			|&byte| byte == 0
		).unwrap_or(Self::MAX_LEN);

		// SAFETY: The bytes before the padding were validated as ASCII
		// alphanumeric, so they are valid UTF-8.
		unsafe { str::from_utf8_unchecked(&self.0[..len]) }
	}
}

// ── `Display` Implementation ────────────────────────────────────────────────
impl Display for NetId {
	fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
		write!(f, "{}", self.as_str())
	}
}

// ── `PartialEq` Implementation ──────────────────────────────────────────────
impl PartialEq for NetId {
	#[inline]
	fn eq(&self, other: &Self) -> bool { self.as_bytes() == other.as_bytes() }
}

// ── `PartialOrd` Implementation ─────────────────────────────────────────────
impl PartialOrd for NetId {
	#[inline]
	fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
		self.as_bytes().partial_cmp(other.as_bytes())
	}
}

// ── `Ord` Implementation ────────────────────────────────────────────────────
impl Ord for NetId {
	#[inline]
	fn cmp(&self, other: &Self) -> Ordering {
		self.as_bytes().cmp(other.as_bytes())
	}
}

// ── `Clone` Implementation ──────────────────────────────────────────────────
impl Clone for NetId {
	#[inline]
	fn clone(&self) -> Self {
		// SAFETY: `self.0` was checked upon the
		// creation of `self` as is valid.
		unsafe { Self::new_unchecked(self.as_str()) }
	}
}