import {expect,test} from "bun:test";
import {RingBuffer} from "@flight/memory";
test("update replaces the newest match and reports evicted items",()=>{const b=new RingBuffer<{id:number;v:number}>(2);b.push({id:1,v:0});b.push({id:2,v:0});b.push({id:2,v:1});expect(b.update(x=>x.id===2,x=>({...x,v:9}))).toBe(true);expect(b.snapshot()).toEqual([{id:2,v:0},{id:2,v:9}]);expect(b.update(x=>x.id===1,x=>x)).toBe(false)});
