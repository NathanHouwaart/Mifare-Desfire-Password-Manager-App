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

} // namespace services
} // namespace core
