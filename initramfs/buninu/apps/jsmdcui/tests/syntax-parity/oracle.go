// Run against an external, unmodified micro checkout; no upstream code is copied.
package main
import (
 "encoding/json"
 "fmt"
 "os"
 "path/filepath"
 "regexp/syntax"
 "sort"
 "strings"
 h "github.com/micro-editor/micro/v2/pkg/highlight"
 "gopkg.in/yaml.v2"
)
func witness(r *syntax.Regexp) string {
 switch r.Op {
 case syntax.OpLiteral: return string(r.Rune)
 case syntax.OpCharClass:
  for _,c:=range "aA0_ /x" {for i:=0;i<len(r.Rune);i+=2{if c>=r.Rune[i]&&c<=r.Rune[i+1]{return string(c)}}};if len(r.Rune)>0{return string(r.Rune[0])}
 case syntax.OpAnyChar,syntax.OpAnyCharNotNL:return "x"
 case syntax.OpCapture:return witness(r.Sub[0])
 case syntax.OpConcat:var b strings.Builder;for _,s:=range r.Sub{b.WriteString(witness(s))};return b.String()
 case syntax.OpAlternate:return witness(r.Sub[0])
 case syntax.OpStar,syntax.OpPlus,syntax.OpQuest:return witness(r.Sub[0])
 case syntax.OpRepeat:n:=r.Min;if n==0&&r.Max!=0{n=1};if n>30{n=30};return strings.Repeat(witness(r.Sub[0]),n)
 };return ""
}
func example(s string)string{r,e:=syntax.Parse(s,syntax.Perl);if e!=nil{return ""};return witness(r)}
func snippets(rules []interface{})[]string{
 var out []string
 for _,item:=range rules{m,ok:=item.(map[interface{}]interface{});if !ok{continue};for k,v:=range m{if k=="include"{continue};switch v:=v.(type){case string:out=append(out,example(v));case map[interface{}]interface{}:
 start,_:=v["start"].(string);end,_:=v["end"].(string);a,b:=example(start),example(end)
 out=append(out,a+"sample 42"+b)
 if nested,ok:=v["rules"].([]interface{});ok{for _,s:=range snippets(nested){out=append(out,a+s+b)}}
 }}}
 return out
}
func main(){
 root:=os.Args[1]; var req struct{Files []string `json:"files"`; Samples map[string]string `json:"samples"`};json.NewDecoder(os.Stdin).Decode(&req)
 paths,_:=filepath.Glob(filepath.Join(root,"*.yaml"));sort.Strings(paths)
 var files []*h.File; data:=map[string][]byte{}
 for _,p:=range paths{b,e:=os.ReadFile(p);if e!=nil{panic(e)};f,e:=h.ParseFile(b);if e!=nil{panic(e)};files=append(files,f);data[filepath.Base(p)]=b}
 results:=map[string]interface{}{}
 for _,name:=range req.Files{b:=data[name];f,e:=h.ParseFile(b);if e!=nil{panic(e)};header,e:=h.MakeHeaderYaml(b);if e!=nil{panic(e)};d,e:=h.ParseDef(f,header);if e!=nil{panic(fmt.Errorf("%s: %w",name,e))};h.ResolveIncludes(d,files)
 text,ok:=req.Samples[name];if !ok{var src map[string]interface{};yaml.Unmarshal(b,&src);rules,_:=src["rules"].([]interface{});ss:=snippets(rules);ss=append(ss,"sample = 42", "\"hello\" # comment", "// TODO: sample", "/* sample */", "true false null", "https://example.com/path");seen:=map[string]bool{};var clean []string;for _,s:=range ss{if s!=""&&!seen[s]{clean=append(clean,s);seen[s]=true}};text=strings.Join(clean,"\n")+"\n"}
 marks:=h.NewHighlighter(d).HighlightString(text);lines:=strings.Split(text,"\n");expanded:=[][]string{}
 for i,line:=range lines{var colors []string;active:="default";for col:=range []rune(line){if g,ok:=marks[i][col];ok{active=g.String();if active==""{active="default"}};colors=append(colors,active)};expanded=append(expanded,colors)}
 results[name]=map[string]interface{}{"text":text,"groups":expanded,"filetype":header.FileType}
 };json.NewEncoder(os.Stdout).Encode(results)
}
