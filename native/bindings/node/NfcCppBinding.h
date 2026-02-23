#pragma once

#include <napi.h>
#include <memory>
#include "../../core/services/NfcService.h"

class NfcCppBinding : public Napi::ObjectWrap<NfcCppBinding> {
public:
    NfcCppBinding(const Napi::CallbackInfo&);
    ~NfcCppBinding();
    Napi::Value Connect(const Napi::CallbackInfo&);
    Napi::Value Disconnect(const Napi::CallbackInfo&);
    Napi::Value SetLogCallback(const Napi::CallbackInfo&);

    static Napi::Function GetClass(Napi::Env);

private:
    std::shared_ptr<core::services::NfcService> _service;
    Napi::ThreadSafeFunction _logTsfn;
    bool _hasLogCallback = false;
};
