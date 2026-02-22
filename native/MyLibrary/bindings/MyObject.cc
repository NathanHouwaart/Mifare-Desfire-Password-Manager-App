#include "MyObject.h"

using namespace Napi;

MyObject::MyObject(const Napi::CallbackInfo& info)
    : ObjectWrap(info)
{
    Napi::Env env = info.Env();
    
    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "You need to name yourself!")
            .ThrowAsJavaScriptException();
        return;
    }

    std::string name = info[0].As<Napi::String>().Utf8Value();
    _actualClass = std::make_unique<MyLibrary>(name);
}

Napi::Value MyObject::Greet(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "You need to introduce yourself to greet!")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string guestName = info[0].As<Napi::String>().Utf8Value();
    std::string result = _actualClass->greet(guestName);

    return Napi::String::New(env, result);
}

Napi::Value MyObject::Add(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsNumber())
    {
        Napi::TypeError::New(env, "You need to provide two numbers to add!")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    double arg0 = info[0].As<Napi::Number>().DoubleValue();
    double arg1 = info[1].As<Napi::Number>().DoubleValue();
    
    double sum = _actualClass->add(arg0, arg1);

    return Napi::Number::New(env, sum);
}

Napi::Function MyObject::GetClass(Napi::Env env)
{
    return DefineClass(
        env,
        "MyObject",
        {
            InstanceMethod("greet", &MyObject::Greet),
            InstanceMethod("add", &MyObject::Add)
        }
    );
}
