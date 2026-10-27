# Holographic mask calibration

The native card PNGs are unchanged. These records describe only the numeric
foreground/background/star masks used by the interactive foil renderer.
Each `variant-*-mask-seeds.json` records the exact input image hash, prompt points,
selected candidate and review provenance. The final numeric paths are in
`../masks/<image-sha>.json`; published SVG bytes are in `../assets/`.

Calibration used local OpenCV inference with the official Apache-2.0
[OpenCV Zoo EfficientSAM-Ti model](https://github.com/opencv/opencv_zoo/tree/main/models/image_segmentation_efficientsam).
The model is not required for the app, offline verification or serving the
published catalog. No image-generation API or external inference service was
used for masks.

- Model: `efficient_sam_ti_2025april.onnx`
- SHA-256: `4eb496e0a7259d435b49b66faf1754aa45a5c382a34558ddda9a8c6fe5915d77`
- [Official model download](https://huggingface.co/opencv/opencv_zoo/resolve/main/models/image_segmentation_efficientsam/image_segmentation_efficientsam_ti_2025april.onnx)
- Prompt coordinates: native 1024 × 1536 card pixels, transformed to the model's
  1024 × 1024 input. Label 1 is a positive point; labels 2/3 bound the subject.
- Reviewed masks are encoded as unions of scanline rectangles, preserving spaces
  between limbs, fins and wings. Painted background stars are separately marked.

The agent inspected the native cards, cutouts on white/black/checkerboard,
silhouette/star overlays, and both tilt directions in the actual card viewer.
The records explicitly distinguish agent review from new human approval.
Derived cutout previews can be regenerated with the existing artwork controller;
the original images, prompts, reference hashes and final masks are preserved.
