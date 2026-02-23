#pragma once

#include <napi.h>
#include <memory>
#include "MyLibrary.h"

class MyLibraryBinding : public Napi::ObjectWrap<MyLibraryBinding> {
public:
    MyLibraryBinding(const Napi::CallbackInfo&);
    Napi::Value Greet(const Napi::CallbackInfo&);
    Napi::Value Add(const Napi::CallbackInfo&);

    static Napi::Function GetClass(Napi::Env);

private:
    std::unique_ptr<MyLibrary> _actualClass;
};
