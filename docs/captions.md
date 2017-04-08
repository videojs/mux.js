# In-Band Captions
Captions come in two varieties, based on their relationship to the
video. Typically on the web, captions are delivered as a separate file
and associated with a video through the `<track>` element. This type
of captions are sometimes referred to as *out-of-band*. The
alternative method involves embedding the caption data directly into
the video content and is sometimes called *in-band captions*. In-band
captions exist in many videos today that were originally encoded for
broadcast and they are also a standard method used to provide captions
for live events.

In-band HLS captions follow the CEA-708 standard.

# References
- [Rec. ITU-T H.264](https://www.itu.int/rec/T-REC-H.264): H.264 video data specification. CEA-708 captions
  are encapsulated in supplemental enhancement information (SEI)
  network abstraction layer (NAL) units within the video stream.
- [ANSI/SCTE
  128-1](https://www.scte.org/documents/pdf/Standards/ANSI_SCTE%20128-1%202013.pdf):
  the binary encapsulation of caption data within an SEI
  user_data_registered_itu_t_t35 payload.
- CEA-708-E: describes the framing and interpretation of caption data
  reassembled out of the picture user data blobs.
- CEA-608-E: specifies the hex to character mapping for extended language
  characters.
