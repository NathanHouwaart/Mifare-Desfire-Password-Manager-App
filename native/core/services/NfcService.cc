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

} // namespace services
} // namespace core
