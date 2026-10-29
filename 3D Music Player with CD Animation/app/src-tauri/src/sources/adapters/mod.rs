//! The sources that are wired up.
//!
//! Each adapter is an implementation of [`crate::sources::types::Source`].
//! They are deliberately different from one another, because that is the
//! point of having several:
//!
//! - [`jamendo`] — open-licensed, whole tracks, a direct address.
//! - [`archive`] — open-licensed and public domain, whole tracks.
//! - [`radio`] — live streams, no end, no length.
//! - [`spotify`] — a catalogue with no audio behind it.
//! - [`youtube`] — real audio, behind an opt-in flag, because it works
//!   through an API its provider's policies forbid.
//!
//! The order they are registered in is the order they are tried in, apart
//! from the last one that worked, which goes first.

pub mod archive;
pub mod jamendo;
pub mod radio;
pub mod spotify;
pub mod youtube;

/// Percent-encode a query for a URL.
pub fn urlencode(text: &str) -> String {
    jamendo::urlencode(text)
}
