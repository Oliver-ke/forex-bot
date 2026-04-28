# MT5 sidecar — Linux + Wine + portable MT5 terminal.
# The MT5 terminal binary is installed at deploy time via a mounted volume so we
# don't ship it in this image. The image only carries Python + the sidecar code.

FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.4.30 /uv /usr/local/bin/uv

WORKDIR /app
COPY pyproject.toml ./
COPY src ./src

# NOTE: The `[mt5]` extra (MetaTrader5 package) is Windows-only and is installed
# at deploy time via Wine onto the running container. The base image carries
# only the Linux-compatible runtime deps; sidecar startup will fail-fast if the
# MetaTrader5 package isn't reachable at runtime.
RUN uv pip install --system -e .

EXPOSE 50051
ENTRYPOINT ["mt5-sidecar"]
