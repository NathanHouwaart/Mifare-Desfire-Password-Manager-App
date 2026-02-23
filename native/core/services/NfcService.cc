#include "NfcService.h"

namespace core {
namespace services {

NfcService::NfcService(std::unique_ptr<ports::INfcReader> reader)
    : _reader(std::move(reader)) {}

ports::Result<std::string> NfcService::connect(const std::string& port) {
    if (!_reader) {
        return ports::NfcError{"NFC Reader is not initialized"};
    }
    return _reader->connect(port);
}

ports::Result<bool> NfcService::disconnect() {
    if (!_reader) {
        return ports::NfcError{"NFC Reader is not initialized"};
    }
    return _reader->disconnect();
}

void NfcService::setLogCallback(ports::NfcLogCallback callback) {
    if (_reader) {
        _reader->setLogCallback(std::move(callback));
    }
}

} // namespace services
} // namespace core
