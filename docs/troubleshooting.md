# Troubleshooting Guide

## Table of Contents
- [608/708 Caption Parsing](caption-parsing)

## 608/708 Caption Parsing

**I have a stream with caption data in more than one field, but only captions from one field are being returned**

You may want to confirm the SEI NAL units are constructed according to the CEA-608 or CEA-708 specification. Specifically:

- that control codes/commands are doubled
- that control codes for the second field start at `0x15` rather than `0x14`, or in other words, are `1 +` the hex value of the equivalent code in the first field.

[caption-parsing]: /docs/troubleshooting.md#608/708-caption-parsing