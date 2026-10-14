# Builds a Lambda layer containing pymediainfo-lambda (includes libmediainfo binaries)
# The SAM CLI invokes the `build-MediaInfoLayer` target by logical ID.
# We only need to `pip install` the wheel into $ARTIFACTS_DIR/python so it ends up under /opt/python at runtime.

PY_MEDIAINFO_VERSION?=0.0.13
PY_MEDIAINFO_PACKAGE=pymediainfo-lambda==$(PY_MEDIAINFO_VERSION)

.PHONY: build build-MediaInfoLayer

build:
	@if [ -z "$(ARTIFACTS_DIR)" ]; then echo "ARTIFACTS_DIR not set" && exit 1 ; fi
	@echo "Installing $(PY_MEDIAINFO_PACKAGE) into $$ARTIFACTS_DIR/python ..."
	mkdir -p $(ARTIFACTS_DIR)/python
	pip install --no-cache-dir --upgrade $(PY_MEDIAINFO_PACKAGE) -t $(ARTIFACTS_DIR)/python
	@echo "MediaInfo layer ready at $(ARTIFACTS_DIR)"

# Alias target expected by SAM (logical id is MediaInfoLayer)
build-MediaInfoLayer: build
	@echo "Invoked alias target build-MediaInfoLayer -> build" 