.PHONY: setup proto test run clean

setup:
	uv venv
	uv pip install -e ".[dev]"

proto:
	uv run python -m grpc_tools.protoc \
		-I../proto \
		--python_out=src/mt5_sidecar/generated \
		--grpc_python_out=src/mt5_sidecar/generated \
		../proto/mt5.proto
	@touch src/mt5_sidecar/generated/__init__.py
	@sed -i 's/^import mt5_pb2 as mt5__pb2$$/from . import mt5_pb2 as mt5__pb2/' \
		src/mt5_sidecar/generated/mt5_pb2_grpc.py

test:
	uv run pytest -v

run:
	uv run mt5-sidecar
