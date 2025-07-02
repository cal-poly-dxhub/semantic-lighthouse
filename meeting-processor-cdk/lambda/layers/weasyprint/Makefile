VERSION=65.1
ZIP=weasyprint-layer-python3.12-x86_64.zip
URL=https://github.com/kotify/cloud-print-utils/releases/download/weasyprint-$(VERSION)/$(ZIP)

.PHONY: build build-WeasyPrintLayer

build:
	@if [ -z "$(ARTIFACTS_DIR)" ]; then echo "ARTIFACTS_DIR not set" && exit 1 ; fi
	@echo "Downloading WeasyPrint layer $(VERSION) ..."
	mkdir -p /tmp/weasyprint
	curl -Ls $(URL) -o /tmp/weasyprint/$(ZIP)
	@echo "Unzipping layer into $$ARTIFACTS_DIR ..."
	unzip -q /tmp/weasyprint/$(ZIP) -d $(ARTIFACTS_DIR)
	@echo "Layer ready at $(ARTIFACTS_DIR)"

# SAM CLI expects a target named "build-<LogicalId>" (LogicalId is WeasyPrintLayer in template.yaml)
# Forward that to the generic build recipe above so `sam build` works out-of-the-box.
build-WeasyPrintLayer: build
	@echo "Invoked alias target build-WeasyPrintLayer -> build" 