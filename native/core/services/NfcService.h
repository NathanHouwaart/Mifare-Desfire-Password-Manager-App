#pragma once
#include <string>
#include <memory>
#include "../ports/INfcReader.h"

namespace core {
namespace services {

class NfcService {
public:
    explicit NfcService(std::unique_ptr<ports::INfcReader> reader);
    ports::Result<std::string> connect(const std::string& port);
    ports::Result<bool> disconnect();
    void setLogCallback(ports::NfcLogCallback callback);

private:
    std::unique_ptr<ports::INfcReader> _reader;
};

} // namespace services
} // namespace core
