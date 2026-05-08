# MT5 sidecar — Linux + Wine 9 stable + Python-on-Windows + portable MT5 terminal.
# Sidecar gRPC server runs INSIDE Wine via `xvfb-run wine python -m mt5_sidecar`.
# See prd/specs/2026-05-06-forex-bot-sidecar-deploy-design.md §4.

FROM ubuntu:24.04 AS wine-base

ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/wine \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=:99

# Ubuntu 24.04 (noble) + distro Wine 9.0. WineHQ's winehq-stable package is
# Wine 11 which has a regression where wineboot --init fails to load
# kernel32.dll in minimal containers (status c0000135). Older Wine versions
# are pruned from WineHQ's noble repo. Ubuntu noble ships wine 9.0~repack in
# universe — battle-tested for container use.
RUN dpkg --add-architecture i386 && \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg xvfb xauth \
      wine wine64 wine32 \
      libfreetype6 libgnutls30 libldap2 \
    && rm -rf /var/lib/apt/lists/*

RUN xvfb-run wine wineboot --init && xvfb-run wineserver -w


FROM wine-base AS python-win

ARG PYTHON_VERSION=3.11.9
RUN curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe" -o /tmp/py.exe && \
    xvfb-run wine /tmp/py.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 && \
    rm /tmp/py.exe && xvfb-run wineserver -w

RUN xvfb-run wine python -m pip install --no-cache-dir \
      MetaTrader5==5.0.45 \
      grpcio==1.66.0 \
      grpcio-health-checking==1.66.0 \
      grpcio-tools==1.66.0 \
      protobuf==5.28.0


FROM python-win AS mt5

RUN curl -fsSL https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe -o /tmp/mt5.exe && \
    xvfb-run wine /tmp/mt5.exe /portable /auto && \
    rm /tmp/mt5.exe && xvfb-run wineserver -w


FROM mt5 AS final

WORKDIR /app
COPY mt5-sidecar/pyproject.toml mt5-sidecar/uv.lock /app/
COPY mt5-sidecar/src /app/src
COPY proto /proto

ARG GRPC_HEALTH_PROBE_VERSION=v0.4.25
RUN curl -fsSL "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64" \
      -o /usr/local/bin/grpc_health_probe && chmod +x /usr/local/bin/grpc_health_probe

# Generate proto stubs into the Wine-side site-packages so the sidecar can import them.
RUN xvfb-run wine python -m grpc_tools.protoc \
      -I/proto \
      --python_out=/app/src/mt5_sidecar/generated \
      --grpc_python_out=/app/src/mt5_sidecar/generated \
      /proto/mt5.proto

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD grpc_health_probe -addr=:50051 || exit 1

COPY mt5-sidecar/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
