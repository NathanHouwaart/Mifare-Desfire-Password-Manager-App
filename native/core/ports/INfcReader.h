#pragma once
#include <string>
#include <variant>
#include <functional>

namespace core {
namespace ports {

struct NfcError {
    std::string message;
};

template <typename T>
using Result = std::variant<T, NfcError>;

using NfcLogCallback = std::function<void(const char* level, const char* message)>;

class INfcReader {
public:
    virtual ~INfcReader() = default;
    virtual Result<std::string> connect(const std::string& port) = 0;
    virtual Result<bool> disconnect() = 0;
    virtual void setLogCallback(NfcLogCallback /*callback*/) {} // optional; default is no-op
};

} // namespace ports
} // namespace core
