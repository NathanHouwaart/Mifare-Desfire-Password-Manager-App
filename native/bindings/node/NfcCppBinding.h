#pragma once

#include <napi.h>
#include <memory>
#include "../../core/services/NfcService.h"

class NfcCppBinding : public Napi::ObjectWrap<NfcCppBinding> {
public:
    NfcCppBinding(const Napi::CallbackInfo&);
    Napi::Value Connect(const Napi::CallbackInfo&);

    static Napi::Function GetClass(Napi::Env);

private:
    std::unique_ptr<core::services::NfcService> _service;
};
