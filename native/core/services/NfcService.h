#pragma once
#include <string>
#include <memory>
#include "../ports/INfcReader.h"

namespace core {
namespace services {

class NfcService {
public:
    explicit NfcService(std::unique_ptr<ports::INfcReader> reader);
    ports::Result<std::string>           connect(const std::string& port);
    ports::Result<bool>                  disconnect();
    ports::Result<std::string>           getFirmwareVersion();
    ports::Result<ports::SelfTestReport> runSelfTests(ports::SelfTestProgressCb onResult = nullptr);
    ports::Result<ports::CardVersionInfo> getCardVersion();
    void setLogCallback(ports::NfcLogCallback callback);

private:
    std::unique_ptr<ports::INfcReader> _reader;
};

} // namespace services
} // namespace core
