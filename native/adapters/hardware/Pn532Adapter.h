#pragma once
#include "../../core/ports/INfcReader.h"
#include <string>
#include <mutex>

namespace adapters {
namespace hardware {

class Pn532Adapter : public core::ports::INfcReader {
public:
    Pn532Adapter();
    core::ports::Result<std::string> connect(const std::string& port) override;

private:
    std::mutex _mutex;
};

} // namespace hardware
} // namespace adapters
