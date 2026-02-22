#pragma once
#include <string>

class MyLibrary {
public:
    MyLibrary(const std::string& name);
    std::string greet(const std::string& guestName) const;
    double add(double a, double b) const;
private:
    std::string _name;
};
