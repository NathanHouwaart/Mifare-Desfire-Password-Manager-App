// NfcCppBinding.cc uses std::ostringstream / std::setw — add needed includes.
// (sstream and iomanip are already pulled in transitively via Pn532Adapter;
//  add them explicitly here for clarity.)
#include <sstream>
#include <iomanip>

#include "NfcCppBinding.h"
#include "../../adapters/hardware/Pn532Adapter.h"

using namespace Napi;

NfcCppBinding::NfcCppBinding(const Napi::CallbackInfo& info)
    : ObjectWrap(info)
{
    auto adapter = std::make_unique<adapters::hardware::Pn532Adapter>();
    _service = std::make_shared<core::services::NfcService>(std::move(adapter));
}

NfcCppBinding::~NfcCppBinding() {
    try {
        _service->setLogCallback(nullptr); // clear handler before TSFN teardown
    } catch (...) {
        // best-effort during teardown
    }

    if (_hasLogCallback) {
        try {
            _logTsfn.Abort();
        } catch (...) {
            // Ignore shutdown-time N-API state errors.
        }
        try {
            _logTsfn.Release();
        } catch (...) {
            // Ignore shutdown-time N-API state errors.
        }
        _hasLogCallback = false;
    }
}

class ConnectWorker : public Napi::AsyncWorker {
public:
    ConnectWorker(Napi::Env& env, Napi::Promise::Deferred deferred, std::shared_ptr<core::services::NfcService> service, std::string port)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)), _port(port) {}

    void Execute() override {
        _result = _service->connect(_port);
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::string>(_result)) {
            _deferred.Resolve(Napi::String::New(env, std::get<std::string>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override {
        Napi::Env env = Env();
        _deferred.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    std::string _port;
    core::ports::Result<std::string> _result;
};

class DisconnectWorker : public Napi::AsyncWorker {
public:
    DisconnectWorker(Napi::Env& env, Napi::Promise::Deferred deferred, std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override {
        _result = _service->disconnect();
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<bool>(_result)) {
            _deferred.Resolve(Napi::Boolean::New(env, std::get<bool>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override {
        Napi::Env env = Env();
        _deferred.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<bool> _result;
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

    ConnectWorker* worker = new ConnectWorker(env, deferred, _service, port);
    worker->Queue();

    return deferred.Promise();
}

// ─── GetFirmwareVersion ───────────────────────────────────────────────────────

class GetFirmwareVersionWorker : public Napi::AsyncWorker {
public:
    GetFirmwareVersionWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                             std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override {
        _result = _service->getFirmwareVersion();
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::string>(_result)) {
            _deferred.Resolve(Napi::String::New(env, std::get<std::string>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<std::string> _result;
};

Napi::Value NfcCppBinding::GetFirmwareVersion(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    GetFirmwareVersionWorker* worker = new GetFirmwareVersionWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── RunSelfTests ─────────────────────────────────────────────────────────────

// Converts a SelfTestResult outcome to its JS string representation.
static std::string outcomeToString(core::ports::TestOutcome outcome) {
    switch (outcome) {
        case core::ports::TestOutcome::Success: return "success";
        case core::ports::TestOutcome::Failed:  return "failed";
        case core::ports::TestOutcome::Skipped: return "skipped";
    }
    return "failed";
}

class RunSelfTestsWorker : public Napi::AsyncProgressWorker<core::ports::SelfTestResult> {
public:
    // onProgress is optional — null TSFN means no streaming (caller didn't pass a callback)
    RunSelfTestsWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                       std::shared_ptr<core::services::NfcService> service,
                       Napi::ThreadSafeFunction progressTsfn)
        : Napi::AsyncProgressWorker<core::ports::SelfTestResult>(env),
          _deferred(deferred), _service(std::move(service)),
          _progressTsfn(std::move(progressTsfn)) {}

    void Execute(const ExecutionProgress& progress) override {
        // Wire the C++ progress callback to AsyncProgressWorker::Send()
        // so each completed test is marshalled to OnProgress() on the JS thread.
        _result = _service->runSelfTests([&progress](const core::ports::SelfTestResult& r) {
            progress.Send(&r, 1);
        });
    }

    void OnProgress(const core::ports::SelfTestResult* data, size_t count) override {
        // Already on the JS main thread — call the TSFN synchronously.
        Napi::HandleScope scope(Env());
        for (size_t i = 0; i < count; ++i) {
            const auto& r = data[i];
            std::string name   = r.name;
            std::string status = outcomeToString(r.outcome);
            std::string detail = r.detail;
            _progressTsfn.NonBlockingCall([name, status, detail](Napi::Env env, Napi::Function fn) {
                Napi::Object row = Napi::Object::New(env);
                row.Set("name",   Napi::String::New(env, name));
                row.Set("status", Napi::String::New(env, status));
                row.Set("detail", Napi::String::New(env, detail));
                fn.Call({row});
            });
        }
    }

    void OnOK() override {
        _progressTsfn.Release();
        Napi::Env env = Env();
        if (std::holds_alternative<core::ports::SelfTestReport>(_result)) {
            const auto& report = std::get<core::ports::SelfTestReport>(_result);
            Napi::Object obj = Napi::Object::New(env);
            Napi::Array  arr = Napi::Array::New(env, 5);
            for (uint32_t i = 0; i < 5; ++i) {
                const auto& r    = report.results[i];
                Napi::Object row = Napi::Object::New(env);
                row.Set("name",   Napi::String::New(env, r.name));
                row.Set("status", Napi::String::New(env, outcomeToString(r.outcome)));
                row.Set("detail", Napi::String::New(env, r.detail));
                arr.Set(i, row);
            }
            obj.Set("results", arr);
            _deferred.Resolve(obj);
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override {
        _progressTsfn.Release();
        _deferred.Reject(e.Value());
    }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<core::ports::SelfTestReport> _result;
    Napi::ThreadSafeFunction _progressTsfn;
};

Napi::Value NfcCppBinding::RunSelfTests(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    // info[0] is an optional JS progress callback (onResult: (row) => void)
    Napi::Function progressFn = (info.Length() >= 1 && info[0].IsFunction())
        ? info[0].As<Napi::Function>()
        : Napi::Function::New(env, [](const Napi::CallbackInfo&){});

    auto tsfn = Napi::ThreadSafeFunction::New(env, progressFn, "SelfTestProgress", 32, 1);
    RunSelfTestsWorker* worker = new RunSelfTestsWorker(env, deferred, _service, std::move(tsfn));
    worker->Queue();
    return deferred.Promise();
}

// ─── GetCardVersion ───────────────────────────────────────────────────────────

class GetCardVersionWorker : public Napi::AsyncWorker {
public:
    GetCardVersionWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                         std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override {
        _result = _service->getCardVersion();
    }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<core::ports::CardVersionInfo>(_result)) {
            const auto& info = std::get<core::ports::CardVersionInfo>(_result);
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("hwVersion",     Napi::String::New(env, info.hwVersion));
            obj.Set("swVersion",     Napi::String::New(env, info.swVersion));
            obj.Set("uidHex",        Napi::String::New(env, info.uidHex));
            obj.Set("storage",       Napi::String::New(env, info.storage));
            obj.Set("rawVersionHex", Napi::String::New(env, info.rawVersionHex));
            _deferred.Resolve(obj);
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<core::ports::CardVersionInfo> _result;
};

Napi::Value NfcCppBinding::GetCardVersion(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    GetCardVersionWorker* worker = new GetCardVersionWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── PeekCardUid ──────────────────────────────────────────────────────────────

class PeekCardUidWorker : public Napi::AsyncWorker {
public:
    PeekCardUidWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                      std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override { _result = _service->peekCardUid(); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::vector<uint8_t>>(_result)) {
            const auto& uid = std::get<std::vector<uint8_t>>(_result);
            // Return colon-separated hex string, e.g. "04:A1:B2:C3:D4:E5:F6"
            std::ostringstream ss;
            ss << std::hex << std::uppercase;
            for (size_t i = 0; i < uid.size(); ++i) {
                if (i > 0) ss << ":";
                ss << std::setw(2) << std::setfill('0') << static_cast<int>(uid[i]);
            }
            _deferred.Resolve(Napi::String::New(env, ss.str()));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            if (nfcErr.code == "NO_CARD") {
                _deferred.Resolve(env.Null());
            } else {
                auto err = Napi::Error::New(env, nfcErr.message);
                err.Set("code", Napi::String::New(env, nfcErr.code));
                _deferred.Reject(err.Value());
            }
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<std::vector<uint8_t>> _result;
};

Napi::Value NfcCppBinding::PeekCardUid(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    PeekCardUidWorker* worker = new PeekCardUidWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── IsCardInitialised ────────────────────────────────────────────────────────

class IsCardInitialisedWorker : public Napi::AsyncWorker {
public:
    IsCardInitialisedWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                            std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override { _result = _service->isCardInitialised(); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<bool>(_result)) {
            _deferred.Resolve(Napi::Boolean::New(env, std::get<bool>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<bool> _result;
};

Napi::Value NfcCppBinding::IsCardInitialised(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    IsCardInitialisedWorker* worker = new IsCardInitialisedWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── ProbeCard ────────────────────────────────────────────────────────────────

class ProbeCardWorker : public Napi::AsyncWorker {
public:
    ProbeCardWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                    std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override { _result = _service->probeCard(); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<core::ports::CardProbeResult>(_result)) {
            const auto& probe = std::get<core::ports::CardProbeResult>(_result);
            Napi::Object obj = Napi::Object::New(env);

            if (probe.uid.empty()) {
                obj.Set("uid", env.Null());
            } else {
                std::ostringstream ss;
                ss << std::hex << std::uppercase;
                for (size_t i = 0; i < probe.uid.size(); ++i) {
                    if (i > 0) ss << ":";
                    ss << std::setw(2) << std::setfill('0') << static_cast<int>(probe.uid[i]);
                }
                obj.Set("uid", Napi::String::New(env, ss.str()));
            }

            obj.Set("isInitialised", Napi::Boolean::New(env, probe.isInitialised));
            _deferred.Resolve(obj);
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            if (nfcErr.code == "NO_CARD") {
                // No card present — resolve with null uid and false
                Napi::Object obj = Napi::Object::New(env);
                obj.Set("uid", env.Null());
                obj.Set("isInitialised", Napi::Boolean::New(env, false));
                _deferred.Resolve(obj);
            } else {
                auto err = Napi::Error::New(env, nfcErr.message);
                err.Set("code", Napi::String::New(env, nfcErr.code));
                _deferred.Reject(err.Value());
            }
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<core::ports::CardProbeResult> _result;
};

Napi::Value NfcCppBinding::ProbeCard(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    ProbeCardWorker* worker = new ProbeCardWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── InitCard ─────────────────────────────────────────────────────────────────

class InitCardWorker : public Napi::AsyncWorker {
public:
    InitCardWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                   std::shared_ptr<core::services::NfcService> service,
                   core::ports::CardInitOptions opts)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)),
          _opts(opts) {}

    void Execute() override { _result = _service->initCard(_opts); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<bool>(_result)) {
            _deferred.Resolve(Napi::Boolean::New(env, std::get<bool>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::CardInitOptions _opts;
    core::ports::Result<bool> _result;
};

// Helper: extract an N-byte std::array from a Napi::Array argument.
template <size_t N>
static std::array<uint8_t, N> napiArrayToStdArray(
    Napi::Env env, const Napi::Array& arr, const char* fieldName) {
    if (arr.Length() != N) {
        throw Napi::TypeError::New(env,
            std::string(fieldName) + " must be exactly " + std::to_string(N) + " bytes");
    }
    std::array<uint8_t, N> out;
    for (size_t i = 0; i < N; ++i)
        out[i] = static_cast<uint8_t>(arr.Get(i).As<Napi::Number>().Uint32Value());
    return out;
}

Napi::Value NfcCppBinding::InitCard(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected an options object").ThrowAsJavaScriptException();
        return env.Undefined();
    }
    Napi::Object opts = info[0].As<Napi::Object>();

    core::ports::CardInitOptions cardOpts;
    try {
        cardOpts.aid          = napiArrayToStdArray<3> (env, opts.Get("aid").As<Napi::Array>(),          "aid");
        cardOpts.appMasterKey = napiArrayToStdArray<16>(env, opts.Get("appMasterKey").As<Napi::Array>(), "appMasterKey");
        cardOpts.readKey      = napiArrayToStdArray<16>(env, opts.Get("readKey").As<Napi::Array>(),      "readKey");
        cardOpts.cardSecret   = napiArrayToStdArray<16>(env, opts.Get("cardSecret").As<Napi::Array>(),   "cardSecret");
    } catch (const Napi::Error& e) {
        e.ThrowAsJavaScriptException();
        return env.Undefined();
    }

    InitCardWorker* worker = new InitCardWorker(env, deferred, _service, cardOpts);
    worker->Queue();
    return deferred.Promise();
}

// ─── ReadCardSecret ───────────────────────────────────────────────────────────

class ReadCardSecretWorker : public Napi::AsyncWorker {
public:
    ReadCardSecretWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                         std::shared_ptr<core::services::NfcService> service,
                         std::array<uint8_t, 16> readKey)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)),
          _readKey(readKey) {}

    void Execute() override { _result = _service->readCardSecret(_readKey); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::vector<uint8_t>>(_result)) {
            const auto& data = std::get<std::vector<uint8_t>>(_result);
            _deferred.Resolve(Napi::Buffer<uint8_t>::Copy(
                env, data.data(), data.size()));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    std::array<uint8_t, 16> _readKey;
    core::ports::Result<std::vector<uint8_t>> _result;
};

Napi::Value NfcCppBinding::ReadCardSecret(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Expected readKey as 16-element array").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    std::array<uint8_t, 16> readKey;
    try {
        readKey = napiArrayToStdArray<16>(env, info[0].As<Napi::Array>(), "readKey");
    } catch (const Napi::Error& e) {
        e.ThrowAsJavaScriptException();
        return env.Undefined();
    }

    ReadCardSecretWorker* worker = new ReadCardSecretWorker(env, deferred, _service, readKey);
    worker->Queue();
    return deferred.Promise();
}

// ─── CardFreeMemory ───────────────────────────────────────────────────────────

class CardFreeMemoryWorker : public Napi::AsyncWorker {
public:
    CardFreeMemoryWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                         std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override { _result = _service->cardFreeMemory(); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<uint32_t>(_result)) {
            _deferred.Resolve(Napi::Number::New(env, std::get<uint32_t>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<uint32_t> _result;
};

Napi::Value NfcCppBinding::CardFreeMemory(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    CardFreeMemoryWorker* worker = new CardFreeMemoryWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── FormatCard ───────────────────────────────────────────────────────────────

class FormatCardWorker : public Napi::AsyncWorker {
public:
    FormatCardWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                     std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override { _result = _service->formatCard(); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<bool>(_result)) {
            _deferred.Resolve(Napi::Boolean::New(env, std::get<bool>(_result)));
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<bool> _result;
};

Napi::Value NfcCppBinding::FormatCard(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    FormatCardWorker* worker = new FormatCardWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

// ─── GetCardApplicationIds ────────────────────────────────────────────────────

class GetCardApplicationIdsWorker : public Napi::AsyncWorker {
public:
    GetCardApplicationIdsWorker(Napi::Env& env, Napi::Promise::Deferred deferred,
                                std::shared_ptr<core::services::NfcService> service)
        : Napi::AsyncWorker(env), _deferred(deferred), _service(std::move(service)) {}

    void Execute() override { _result = _service->getCardApplicationIds(); }

    void OnOK() override {
        Napi::Env env = Env();
        if (std::holds_alternative<std::vector<std::array<uint8_t, 3>>>(_result)) {
            const auto& aids = std::get<std::vector<std::array<uint8_t, 3>>>(_result);
            Napi::Array arr = Napi::Array::New(env, aids.size());
            for (size_t i = 0; i < aids.size(); ++i) {
                // Return each AID as uppercase hex string, e.g. "505700"
                std::ostringstream ss;
                ss << std::hex << std::uppercase << std::setfill('0');
                for (auto b : aids[i]) ss << std::setw(2) << static_cast<int>(b);
                arr.Set(i, Napi::String::New(env, ss.str()));
            }
            _deferred.Resolve(arr);
        } else {
            const auto& nfcErr = std::get<core::ports::NfcError>(_result);
            auto err = Napi::Error::New(env, nfcErr.message);
            err.Set("code", Napi::String::New(env, nfcErr.code));
            _deferred.Reject(err.Value());
        }
    }

    void OnError(const Napi::Error& e) override { _deferred.Reject(e.Value()); }

private:
    Napi::Promise::Deferred _deferred;
    std::shared_ptr<core::services::NfcService> _service;
    core::ports::Result<std::vector<std::array<uint8_t, 3>>> _result;
};

Napi::Value NfcCppBinding::GetCardApplicationIds(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);
    GetCardApplicationIdsWorker* worker = new GetCardApplicationIdsWorker(env, deferred, _service);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value NfcCppBinding::Disconnect(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();
    Napi::Promise::Deferred deferred = Napi::Promise::Deferred::New(env);

    DisconnectWorker* worker = new DisconnectWorker(env, deferred, _service);
    worker->Queue();

    return deferred.Promise();
}

Napi::Value NfcCppBinding::SetLogCallback(const Napi::CallbackInfo& info)
{
    Napi::Env env = info.Env();

    // Clear callback when invoked with no args / null / undefined.
    const bool shouldClear =
        info.Length() < 1 || info[0].IsUndefined() || info[0].IsNull();
    if (_hasLogCallback) {
        _service->setLogCallback(nullptr);
        try {
            _logTsfn.Abort();
        } catch (...) {
            // Ignore transient teardown errors.
        }
        try {
            _logTsfn.Release();
        } catch (...) {
            // Ignore transient teardown errors.
        }
        _hasLogCallback = false;
    }
    if (shouldClear) {
        return env.Undefined();
    }

    if (!info[0].IsFunction()) {
        Napi::TypeError::New(env, "Expected a function").ThrowAsJavaScriptException();
        return env.Undefined();
    }

    _logTsfn = Napi::ThreadSafeFunction::New(
        env,
        info[0].As<Napi::Function>(),
        "NfcLogCallback",
        128, // bounded queue — log entries are dropped on overflow
        1    // initial thread count
    );
    _hasLogCallback = true;

    // Capture TSFN by value — avoids raw 'this' dangling pointer entirely
    auto tsfn = _logTsfn;
    _service->setLogCallback([tsfn](const char* level, const char* message) mutable {
        std::string lvl(level);
        std::string msg(message);
        auto status = tsfn.NonBlockingCall([lvl, msg](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({
                Napi::String::New(env, lvl),
                Napi::String::New(env, msg)
            });
        });
        // napi_closing  → TSFN is shutting down, safe to drop
        // napi_queue_full → bounded overflow, safe to drop
        (void)status;
    });

    return env.Undefined();
}

Napi::Function NfcCppBinding::GetClass(Napi::Env env)
{
    return DefineClass(
        env,
        "NfcCppBinding",
        {
            InstanceMethod("connect",                &NfcCppBinding::Connect),
            InstanceMethod("disconnect",             &NfcCppBinding::Disconnect),
            InstanceMethod("setLogCallback",         &NfcCppBinding::SetLogCallback),
            InstanceMethod("getFirmwareVersion",     &NfcCppBinding::GetFirmwareVersion),
            InstanceMethod("runSelfTests",           &NfcCppBinding::RunSelfTests),
            InstanceMethod("getCardVersion",         &NfcCppBinding::GetCardVersion),
            InstanceMethod("peekCardUid",            &NfcCppBinding::PeekCardUid),
            InstanceMethod("isCardInitialised",      &NfcCppBinding::IsCardInitialised),
            InstanceMethod("probeCard",              &NfcCppBinding::ProbeCard),
            InstanceMethod("initCard",               &NfcCppBinding::InitCard),
            InstanceMethod("readCardSecret",         &NfcCppBinding::ReadCardSecret),
            InstanceMethod("cardFreeMemory",         &NfcCppBinding::CardFreeMemory),
            InstanceMethod("formatCard",             &NfcCppBinding::FormatCard),
            InstanceMethod("getCardApplicationIds",  &NfcCppBinding::GetCardApplicationIds),
        }
    );
}
