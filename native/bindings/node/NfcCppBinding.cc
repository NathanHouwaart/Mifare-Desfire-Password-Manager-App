#include "NfcCppBinding.h"
#include "../../adapters/hardware/Pn532Adapter.h"

using namespace Napi;

NfcCppBinding::NfcCppBinding(const Napi::CallbackInfo& info)
    : ObjectWrap(info)
{
    auto adapter = std::make_unique<adapters::hardware::Pn532Adapter>();
    _service = std::make_unique<core::services::NfcService>(std::move(adapter));
}

class ConnectWorker : public Napi::AsyncWorker {
public:
    ConnectWorker(Napi::Env& env, Napi::Promise::Deferred deferred, core::services::NfcService* service, std::string port)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(service), _port(port) {}

    void Execute() override {
        _result = _service->connect(_port);
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::string>(_result)) {
            _deferred.Resolve(Napi::String::New(env, std::get<std::string>(_result)));
        } else {
            auto error = std::get<core::ports::NfcError>(_result);
            _deferred.Reject(Napi::Error::New(env, error.message).Value());
        }
    }

    void OnError(const Napi::Error& e) override {
        Napi::Env env = Env();
        _deferred.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred _deferred;
    core::services::NfcService* _service;
    std::string _port;
    core::ports::Result<std::string> _result;
};

Napi::Value NfcCppBinding::Connect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString())
    {
        Napi::TypeError::New(env, "You need to provide a COM port string!")
            .ThrowAsJavaScriptException();
        return env.Null();
    }

    std::string port = info[0].As<Napi::String>().Utf8Value();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    ConnectWorker* worker = new ConnectWorker(env, deferred, _service.get(), port);
    worker->Queue();

    return deferred.Promise();
}

Napi::Function NfcCppBinding::GetClass(Napi::Env env)
{
    return DefineClass(
        env,
        "NfcCppBinding",
        {
            InstanceMethod("connect", &NfcCppBinding::Connect)
        }
    );
}
