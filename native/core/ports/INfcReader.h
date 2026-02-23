#pragma once
#include <string>
#include <variant>

namespace core {
namespace ports {

struct NfcError {
    std::string message;
};

template <typename T>
using Result = std::variant<T, NfcError>;

class INfcReader {
public:
    virtual ~INfcReader() = default;
    virtual Result<std::string> connect(const std::string& port) = 0;
};

} // namespace ports
} // namespace core
