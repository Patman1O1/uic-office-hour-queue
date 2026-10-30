// ── Aliases ─────────────────────────────────────────────────────────────────
use super::*;
use core::mem;

// ── Fixtures ────────────────────────────────────────────────────────────────
/// Inputs that are valid NetIDs, one of every allowed length.
const VALID: &[&str] = &["abc", "abc1", "AbC12", "pthom2", "a1b2c3d", "abcd1234"];

/// Inputs that are not valid NetIDs, with the reason each one is rejected.
const INVALID: &[(&str, &str)] = &[
	("", "empty"),
	("a", "too short"),
	("ab", "too short"),
	("abcdefghi", "too long"),
	("abcd12345678", "too long"),
	("ab_c", "underscore"),
	("ab-c", "hyphen"),
	("ab c", "space"),
	("abc!", "punctuation"),
	("abc\n", "trailing newline"),
	(" abc", "leading whitespace"),
	("abc\0", "NUL byte"),
	("abcé", "non-ASCII letter"),
	("日本", "non-ASCII, 6 bytes but 2 chars"),
	("١٢٣", "non-ASCII digits"),
];

/// Builds a `NetId` from a string that is expected to be valid.
fn net_id(value: &str) -> NetId {
	NetId::new(value).unwrap_or_else(|| panic!("{value:?} should be a valid NetId"))
}

/// The bytes of `value` followed by zero padding up to `NetId::MAX_LEN`.
fn padded(value: &str) -> [u8; NetId::MAX_LEN] {
	let mut buf = [0u8; NetId::MAX_LEN];
	buf[..value.len()].copy_from_slice(value.as_bytes());
	buf
}

// ── Function Tests ──────────────────────────────────────────────────────────
mod functions {
	// ── Aliases ─────────────────────────────────────────────────────────────
	use super::*;

	// ── `NetId::is_valid()` ─────────────────────────────────────────────────
	mod is_valid {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn accepts_valid_inputs() {
			for value in VALID {
				assert!(NetId::is_valid(value), "{value:?} should be valid");
			}
		}

		#[test]
		fn accepts_every_length_in_range() {
			for len in NetId::MIN_LEN..=NetId::MAX_LEN {
				let value = "a".repeat(len);
				assert!(NetId::is_valid(&value), "length {len} should be valid");
			}
		}

		#[test]
		fn accepts_every_ascii_alphanumeric_byte() {
			for byte in (0u8..=127).filter(u8::is_ascii_alphanumeric) {
				let value = format!("ab{}", byte as char);
				assert!(NetId::is_valid(&value), "{value:?} should be valid");
			}
		}

		#[test]
		fn rejects_lengths_out_of_range() {
			for len in (0..NetId::MIN_LEN).chain(NetId::MAX_LEN + 1..=NetId::MAX_LEN + 4) {
				let value = "a".repeat(len);
				assert!(!NetId::is_valid(&value), "length {len} should be invalid");
			}
		}

		#[test]
		fn rejects_every_ascii_non_alphanumeric_byte() {
			for byte in (0u8..=127).filter(|byte| !byte.is_ascii_alphanumeric()) {
				let value = format!("ab{}", byte as char);
				assert!(!NetId::is_valid(&value), "{value:?} should be invalid");
			}
		}

		#[test]
		fn rejects_invalid_inputs() {
			for (value, reason) in INVALID {
				assert!(!NetId::is_valid(value), "{value:?} should be invalid ({reason})");
			}
		}
	}

	// ── `NetId::new()` ──────────────────────────────────────────────────────
	mod new {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn accepts_valid_inputs() {
			for value in VALID {
				assert!(NetId::new(value).is_some(), "{value:?} should be accepted");
			}
		}

		#[test]
		fn rejects_invalid_inputs() {
			for (value, reason) in INVALID {
				assert!(NetId::new(value).is_none(), "{value:?} should be rejected ({reason})");
			}
		}

		#[test]
		fn agrees_with_is_valid() {
			for value in VALID.iter().copied().chain(INVALID.iter().map(|(value, _)| *value)) {
				assert_eq!(NetId::new(value).is_some(), NetId::is_valid(value), "{value:?}");
			}
		}

		#[test]
		fn zero_pads_short_inputs() {
			for value in VALID {
				assert_eq!(net_id(value).0, padded(value), "{value:?}");
			}
		}

		#[test]
		fn stores_max_length_input_without_padding() {
			assert_eq!(&net_id("abcd1234").0, b"abcd1234");
		}
	}

	// ── `NetId::new_unchecked()` ────────────────────────────────────────────
	mod new_unchecked {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn zero_pads_short_inputs() {
			for value in VALID {
				// SAFETY: Every entry in `VALID` is a valid NetId.
				let id = unsafe { NetId::new_unchecked(value) };
				assert_eq!(id.0, padded(value), "{value:?}");
			}
		}

		#[test]
		fn matches_new_for_valid_inputs() {
			for value in VALID {
				// SAFETY: Every entry in `VALID` is a valid NetId.
				let unchecked = unsafe { NetId::new_unchecked(value) };
				assert_eq!(unchecked, net_id(value), "{value:?}");
			}
		}
	}
}

// ── Method Tests ────────────────────────────────────────────────────────────
mod methods {
	// ── Aliases ─────────────────────────────────────────────────────────────
	use super::*;

	mod as_bytes {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn returns_zero_padded_bytes() {
			for value in VALID {
				assert_eq!(net_id(value).as_bytes(), &padded(value), "{value:?}");
			}
		}

		#[test]
		fn borrows_the_inner_array() {
			let id = net_id("abc");
			assert!(core::ptr::eq(id.as_bytes(), &id.0));
		}
	}

	mod as_str {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn round_trips_valid_inputs() {
			for value in VALID {
				assert_eq!(net_id(value).as_str(), *value);
			}
		}

		#[test]
		fn excludes_padding() {
			for value in VALID {
				let id = net_id(value);
				assert_eq!(id.as_str().len(), value.len(), "{value:?}");
				assert!(!id.as_str().contains('\0'), "{value:?} leaked padding");
			}
		}

		#[test]
		fn round_trips_through_new() {
			for value in VALID {
				let id = net_id(value);
				assert_eq!(NetId::new(id.as_str()), Some(id), "{value:?}");
			}
		}
	}
}

// ── Trait Tests ─────────────────────────────────────────────────────────────
mod traits {
	// ── Aliases ─────────────────────────────────────────────────────────────
	use super::*;
	use std::{format, vec::Vec};

	// ── Display ─────────────────────────────────────────────────────────────
	mod display {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn matches_input() {
			for value in VALID {
				assert_eq!(format!("{}", net_id(value)), *value);
			}
		}

		#[test]
		fn matches_as_str() {
			for value in VALID {
				let id = net_id(value);
				assert_eq!(id.to_string(), id.as_str());
			}
		}
	}

	// ── `Debug` ─────────────────────────────────────────────────────────────
	mod debug {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn names_the_type() {
			assert!(format!("{:?}", net_id("abc")).starts_with("NetId"));
		}
	}

	// ── `PartialEq`/`Eq` ────────────────────────────────────────────────────
	mod partial_eq_and_eq {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn eq_for_same_input() {
			for value in VALID {
				assert_eq!(net_id(value), net_id(value));
			}
		}

		#[test]
		fn ne_for_different_inputs() {
			for (i, a) in VALID.iter().enumerate() {
				for b in &VALID[i + 1..] {
					assert_ne!(net_id(a), net_id(b), "{a:?} vs {b:?}");
				}
			}
		}

		#[test]
		fn ne_when_one_is_a_prefix_of_the_other() {
			assert_ne!(net_id("abc"), net_id("abcd"));
			assert_ne!(net_id("abcd123"), net_id("abcd1234"));
		}

		#[test]
		fn eq_is_case_sensitive() {
			assert_ne!(net_id("abc"), net_id("ABC"));
			assert_ne!(net_id("pthom2"), net_id("Pthom2"));
		}
	}

	// ── `PartialOrd`/`Ord` ──────────────────────────────────────────────────
	mod partial_ord_and_ord {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		/// Every pair of `VALID` plus pairs chosen to test prefixes and ASCII order.
		fn ordering_pairs() -> Vec<(&'static str, &'static str)> {
			let mut pairs: Vec<_> = VALID
				.iter()
				.flat_map(|a| VALID.iter().map(move |b| (*a, *b)))
				.collect();
			pairs.extend([
				("abc", "abcd"),
				("abcd123", "abcd1234"),
				("abc", "abd"),
				("zzz", "aaaa"),
				("ABC", "abc"),
				("123", "ABC"),
				("abc9", "abcA"),
			]);
			pairs
		}

		#[test]
		fn cmp_matches_str_ordering() {
			for (a, b) in ordering_pairs() {
				assert_eq!(net_id(a).cmp(&net_id(b)), a.cmp(b), "{a:?} vs {b:?}");
			}
		}

		#[test]
		fn partial_cmp_agrees_with_cmp() {
			for (a, b) in ordering_pairs() {
				let (a, b) = (net_id(a), net_id(b));
				assert_eq!(a.partial_cmp(&b), Some(a.cmp(&b)), "{a} vs {b}");
			}
		}

		#[test]
		fn prefix_sorts_first() {
			assert!(net_id("abc") < net_id("abcd"));
			assert!(net_id("abcd") > net_id("abc"));
		}

		#[test]
		fn sorting_matches_sorting_strings() {
			let mut strings: Vec<&str> =
				["pthom2", "abcd", "ABC", "abc", "zz9", "123", "abcd1234", "abc1"].into();
			let mut ids: Vec<NetId> = strings.iter().map(|value| net_id(value)).collect();

			strings.sort();
			ids.sort();

			let sorted: Vec<&str> = ids.iter().map(NetId::as_str).collect();
			assert_eq!(sorted, strings);
		}

		#[test]
		fn min_and_max() {
			assert_eq!(net_id("abc").min(net_id("abd")), net_id("abc"));
			assert_eq!(net_id("abc").max(net_id("abd")), net_id("abd"));
		}
	}

	// ── Display ─────────────────────────────────────────────────────────────
	mod clone {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		#[allow(clippy::clone_on_copy)]
		fn equals_original() {
			for value in VALID {
				let id = net_id(value);
				let clone = id.clone();
				assert_eq!(clone, id);
				assert_eq!(clone.0, id.0, "{value:?}");
			}
		}
	}

	// ── `Copy` ──────────────────────────────────────────────────────────────
	mod copy {
		// ── Aliases ─────────────────────────────────────────────────────────
		use super::*;

		// ── Tests ───────────────────────────────────────────────────────────
		#[test]
		fn leaves_original_usable() {
			let original = net_id("pthom2");
			let copy = original;
			assert_eq!(original, copy);
			assert_eq!(original.as_str(), "pthom2");
		}
	}
}