# mt5-sidecar — Linux Python with pluggable broker provider.
# Provider chosen at runtime via BROKER_PROVIDER env var (default: metaapi).
# See prd/specs/2026-05-12-forex-bot-broker-provider-design.md.

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/v0.4.25/grpc_health_probe-linux-amd64 \
      -o /usr/local/bin/grpc_health_probe \
    && chmod +x /usr/local/bin/grpc_health_probe

COPY mt5-sidecar/pyproject.toml mt5-sidecar/uv.lock /app/
COPY mt5-sidecar/src /app/src
COPY proto /proto

RUN pip install --no-cache-dir \
      grpcio==1.66.0 \
      grpcio-health-checking==1.66.0 \
      grpcio-tools==1.66.0 \
      protobuf==5.28.0 \
      metaapi-cloud-sdk>=27.0.0

# Generate proto stubs (writes into /app/src/mt5_sidecar/generated/).
# Post-gen: rewrite the absolute `import mt5_pb2` to a package-relative form
# so the generated stub loads under `mt5_sidecar.generated.*`.
RUN python -m grpc_tools.protoc \
      -I/proto \
      --python_out=/app/src/mt5_sidecar/generated \
      --grpc_python_out=/app/src/mt5_sidecar/generated \
      /proto/mt5.proto \
    && python -c "import pathlib; p = pathlib.Path('/app/src/mt5_sidecar/generated/mt5_pb2_grpc.py'); s = p.read_text(); p.write_text(s.replace('import mt5_pb2 as mt5__pb2', 'from . import mt5_pb2 as mt5__pb2'))"

ENV PYTHONPATH=/app/src

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD grpc_health_probe -addr=:50051 || exit 1

ENTRYPOINT ["python", "-m", "mt5_sidecar"]
