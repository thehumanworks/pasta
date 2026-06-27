# Pasta iOS — quick on-device build/install loop.
#
# Fast inner loop while iterating on the keyboard UI:
#   make ios-run                 # build + install + launch on DEVICE
#   make ios-run DEVICE=<id>     # target a specific device (see `make ios-devices`)
#
# Signing: after the first successful device build, the development provisioning
# profile is cached locally and `make ios-run` works with no extra arguments.
# For the first build on a new device (or to refresh provisioning), pass an App
# Store Connect API key so Xcode can register the device:
#   make ios-run ASC_KEY_ID=XXXXXXXX ASC_ISSUER_ID=XXXXXXXX-....
# ASC_KEY_PATH defaults to ios/build/asc/AuthKey.p8 (kept out of git) and is
# resolved to an absolute path, which xcodebuild requires.

IOS_PROJECT := ios/Pasta.xcodeproj
IOS_SCHEME  := Pasta
IOS_CONFIG  := Debug
IOS_DERIVED := ios/build/DerivedData
IOS_APP     := $(IOS_DERIVED)/Build/Products/$(IOS_CONFIG)-iphoneos/Pasta.app
IOS_BUNDLE  := com.thehumanworks.pasta

# Default target device (the paired iPhone Air). Override on the command line.
DEVICE ?= AA3189CF-63E4-5B5B-884D-A39454926E42

# Optional App Store Connect API key auth for device registration / provisioning.
ASC_KEY_PATH ?= ios/build/asc/AuthKey.p8
ASC_AUTH :=
ifdef ASC_KEY_ID
ifdef ASC_ISSUER_ID
ASC_AUTH := -authenticationKeyPath $(abspath $(ASC_KEY_PATH)) -authenticationKeyID $(ASC_KEY_ID) -authenticationKeyIssuerID $(ASC_ISSUER_ID)
endif
endif

.DEFAULT_GOAL := help
.PHONY: help ios-run run-ios ios-build ios-install ios-launch ios-devices

help: ## Show this help
	@grep -hE '^[a-zA-Z0-9_-]+:.*## ' $(MAKEFILE_LIST) | sort | awk -F':.*## ' '{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

ios-run: ios-build ios-install ios-launch ## Build, install, and launch on DEVICE

run-ios: ios-run ## Build, install, and launch on DEVICE

ios-build: ## Build a development-signed Debug app for the device
	xcodebuild -project $(IOS_PROJECT) -scheme $(IOS_SCHEME) -configuration $(IOS_CONFIG) \
		-destination 'platform=iOS,id=$(DEVICE)' -derivedDataPath $(IOS_DERIVED) \
		-allowProvisioningUpdates $(ASC_AUTH) build

ios-install: ## Install the most recent build on DEVICE
	xcrun devicectl device install app --device $(DEVICE) $(IOS_APP)

ios-launch: ## Launch the app on DEVICE
	xcrun devicectl device process launch --device $(DEVICE) $(IOS_BUNDLE)

ios-devices: ## List paired/connected devices and their ids
	xcrun devicectl list devices
