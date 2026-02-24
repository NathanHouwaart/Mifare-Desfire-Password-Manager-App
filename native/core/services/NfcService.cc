#include "NfcService.h"

namespace core {
namespace services {

NfcService::NfcService(std::unique_ptr<ports::INfcReader> reader)
    : _reader(std::move(reader)) {}

ports::Result<std::string> NfcService::connect(const std::string& port) {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->connect(port);
}

ports::Result<bool> NfcService::disconnect() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->disconnect();
}

ports::Result<std::string> NfcService::getFirmwareVersion() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->getFirmwareVersion();
}

ports::Result<ports::SelfTestReport> NfcService::runSelfTests(ports::SelfTestProgressCb onResult) {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->runSelfTests(std::move(onResult));
}

ports::Result<ports::CardVersionInfo> NfcService::getCardVersion() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->getCardVersion();
}

void NfcService::setLogCallback(ports::NfcLogCallback callback) {
    if (_reader) {
        _reader->setLogCallback(std::move(callback));
    }
}

ports::Result<std::vector<uint8_t>> NfcService::peekCardUid() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->peekCardUid();
}

ports::Result<bool> NfcService::isCardInitialised() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->isCardInitialised();
}

ports::Result<ports::CardProbeResult> NfcService::probeCard() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->probeCard();
}

ports::Result<bool> NfcService::initCard(const ports::CardInitOptions& opts) {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->initCard(opts);
}

ports::Result<std::vector<uint8_t>> NfcService::readCardSecret(
    const std::array<uint8_t, 16>& readKey) {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->readCardSecret(readKey);
}

ports::Result<uint32_t> NfcService::cardFreeMemory() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->cardFreeMemory();
}

ports::Result<bool> NfcService::formatCard() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->formatCard();
}

ports::Result<std::vector<std::array<uint8_t, 3>>> NfcService::getCardApplicationIds() {
    if (!_reader) {
        return ports::NfcError{"NOT_CONNECTED", "NFC Reader is not initialized"};
    }
    return _reader->getCardApplicationIds();
}

} // namespace services
} // namespace core
