"""
Analyze codec-log.csv and visualize compression performance with clear Matplotlib charts.

Usage:
  python analyze_codec.py --csv codec-log.csv --out reports

Outputs:
  reports/summary.txt
  reports/compression_ratio.png
  reports/psnr_vs_ratio.png
  reports/size_breakdown.png
  reports/encode_decode_times.png
  reports/discard_vs_psnr.png
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import matplotlib.pyplot as plt

try:
    import pandas as pd
except ImportError:
    print("pandas is required. Install with: pip install pandas matplotlib", file=sys.stderr)
    sys.exit(1)


CSV_HEADER = [
    "timestamp",
    "context",
    "source",
    "width",
    "height",
    "blockSize",
    "discardBits",
    "smooth",
    "psnr",
    "ssim",
    "rawSize",
    "compressedSize",
    "nodalSize",
    "qoiSize",
    "jpegSize",
    "pngSize",
    "webpSize",
    "customEncodeMs",
    "customDecodeMs",
    "jpegEncodeMs",
    "jpegDecodeMs",
    "pngEncodeMs",
    "pngDecodeMs",
    "webpEncodeMs",
    "webpDecodeMs",
]


@dataclass
class PlotPaths:
    summary: Path
    compression_ratio: Path
    psnr_vs_ratio: Path
    size_breakdown: Path
    times: Path
    discard_vs_psnr: Path


def load_data(csv_path: Path) -> pd.DataFrame:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV file not found: {csv_path}")

    df = pd.read_csv(csv_path)
    missing = [col for col in CSV_HEADER if col not in df.columns]
    if missing:
        raise ValueError(f"CSV missing columns: {missing}")

    df["compressionRatio"] = df["rawSize"] / df["compressedSize"]
    df["area"] = df["width"] * df["height"]
    df["discardBits"] = df["discardBits"].astype("Int64")
    df["blockSize"] = df["blockSize"].astype("Int64")
    df["smooth"] = df["smooth"].astype(bool)
    return df


def ensure_out_dir(out_dir: Path) -> PlotPaths:
    out_dir.mkdir(parents=True, exist_ok=True)
    return PlotPaths(
        summary=out_dir / "summary.txt",
        compression_ratio=out_dir / "compression_ratio.png",
        psnr_vs_ratio=out_dir / "psnr_vs_ratio.png",
        size_breakdown=out_dir / "size_breakdown.png",
        times=out_dir / "encode_decode_times.png",
        discard_vs_psnr=out_dir / "discard_vs_psnr.png",
    )


def save_summary(df: pd.DataFrame, paths: PlotPaths) -> None:
    grouped = (
        df.groupby(["discardBits", "blockSize", "smooth"])
        .agg(
            count=("compressionRatio", "count"),
            avg_ratio=("compressionRatio", "mean"),
            med_ratio=("compressionRatio", "median"),
            avg_psnr=("psnr", "mean"),
            med_psnr=("psnr", "median"),
            avg_ssim=("ssim", "mean"),
            med_ssim=("ssim", "median"),
            avg_custom_enc=("customEncodeMs", "mean"),
            avg_custom_dec=("customDecodeMs", "mean"),
        )
        .sort_values("avg_ratio", ascending=False)
    )

    with paths.summary.open("w", encoding="utf-8") as f:
        f.write("Codec log summary\n")
        f.write("==================\n\n")
        f.write(f"Total records: {len(df)}\n\n")
        f.write("Grouped by discardBits, blockSize, smooth:\n")
        f.write(grouped.to_string())
        f.write("\n")


def plot_compression_ratio(df: pd.DataFrame, paths: PlotPaths) -> None:
    plt.figure(figsize=(10, 6))
    for smooth_val, sub in df.groupby("smooth"):
        plt.scatter(
            sub["discardBits"],
            sub["compressionRatio"],
            alpha=0.6,
            label=f"smooth={smooth_val}",
            s=40,
        )
    plt.title("Compression ratio vs discardBits")
    plt.xlabel("discardBits")
    plt.ylabel("compression ratio (raw/custom)")
    plt.legend(title="smooth")
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(paths.compression_ratio, dpi=150)
    plt.close()


def plot_psnr_vs_ratio(df: pd.DataFrame, paths: PlotPaths) -> None:
    plt.figure(figsize=(10, 6))
    scatter = plt.scatter(
        df["compressionRatio"],
        df["psnr"],
        c=df["discardBits"],
        cmap="viridis",
        alpha=0.7,
        s=40,
    )
    plt.colorbar(scatter, label="discardBits")
    plt.title("PSNR vs compression ratio")
    plt.xlabel("compression ratio (raw/custom)")
    plt.ylabel("PSNR (dB)")
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(paths.psnr_vs_ratio, dpi=150)
    plt.close()


def plot_size_breakdown(df: pd.DataFrame, paths: PlotPaths) -> None:
    formats = ["compressedSize", "jpegSize", "pngSize", "webpSize"]
    labels = ["Custom", "JPEG", "PNG", "WebP"]
    medians = [df[col].median() for col in formats]

    plt.figure(figsize=(8, 6))
    bars = plt.bar(labels, medians, color=["#7c3aed", "#f97316", "#0ea5e9", "#22c55e"])
    plt.title("Median size by format")
    plt.ylabel("Bytes")
    plt.grid(axis="y", alpha=0.3)
    for bar, val in zip(bars, medians):
        plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), f"{val/1024:.1f} KB", ha="center", va="bottom")
    plt.tight_layout()
    plt.savefig(paths.size_breakdown, dpi=150)
    plt.close()


def plot_times(df: pd.DataFrame, paths: PlotPaths) -> None:
    time_cols = [
        ("customEncodeMs", "Custom Enc"),
        ("customDecodeMs", "Custom Dec"),
        ("jpegEncodeMs", "JPEG Enc"),
        ("jpegDecodeMs", "JPEG Dec"),
        ("pngEncodeMs", "PNG Enc"),
        ("pngDecodeMs", "PNG Dec"),
        ("webpEncodeMs", "WebP Enc"),
        ("webpDecodeMs", "WebP Dec"),
    ]
    medians = [df[col].median() for col, _ in time_cols]
    labels = [label for _, label in time_cols]

    plt.figure(figsize=(10, 6))
    bars = plt.bar(labels, medians, color="#0f766e")
    plt.title("Median encode/decode times")
    plt.ylabel("Milliseconds")
    plt.xticks(rotation=20, ha="right")
    plt.grid(axis="y", alpha=0.3)
    for bar, val in zip(bars, medians):
        plt.text(bar.get_x() + bar.get_width() / 2, bar.get_height(), f"{val:.1f} ms", ha="center", va="bottom")
    plt.tight_layout()
    plt.savefig(paths.times, dpi=150)
    plt.close()


def plot_discard_vs_psnr(df: pd.DataFrame, paths: PlotPaths) -> None:
    plt.figure(figsize=(10, 6))
    for smooth_val, sub in df.groupby("smooth"):
        plt.plot(
            sub.groupby("discardBits")["psnr"].mean().index,
            sub.groupby("discardBits")["psnr"].mean().values,
            marker="o",
            label=f"smooth={smooth_val}",
        )
    plt.title("Average PSNR vs discardBits")
    plt.xlabel("discardBits")
    plt.ylabel("PSNR (dB)")
    plt.grid(alpha=0.3)
    plt.legend()
    plt.tight_layout()
    plt.savefig(paths.discard_vs_psnr, dpi=150)
    plt.close()


def run(csv_path: Path, out_dir: Path) -> None:
    df = load_data(csv_path)
    paths = ensure_out_dir(out_dir)
    save_summary(df, paths)
    plot_compression_ratio(df, paths)
    plot_psnr_vs_ratio(df, paths)
    plot_size_breakdown(df, paths)
    plot_times(df, paths)
    plot_discard_vs_psnr(df, paths)
    print(f"Saved summary to {paths.summary}")
    print(f"Saved plots to {out_dir}")


def main(argv: Optional[list[str]] = None) -> None:
    parser = argparse.ArgumentParser(description="Analyze codec-log.csv and produce plots.")
    parser.add_argument("--csv", type=Path, default=Path("codec-log.csv"), help="Path to codec-log.csv")
    parser.add_argument("--out", type=Path, default=Path("reports"), help="Directory for outputs")
    args = parser.parse_args(argv)
    run(args.csv, args.out)


if __name__ == "__main__":
    main()
