// haxe -debug Original -js generated.js
using Lambda;
class Original {
  static function main() {
    var array = [0, 1, 2, 3, 4];
    var filteredArray = array.filter(function(v) { return (v % 2 == 0); }).array();
    trace(filteredArray);
  }
}
