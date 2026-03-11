'use client'

import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

export default function Funcionarios() {

const [dados,setDados] = useState([])

useEffect(()=>{
buscar()
},[])

async function buscar(){

const { data } = await supabase
.from('funcionarios')
.select('*')

setDados(data)

}

return (

<div style={{padding:40}}>

<h1>Funcionários</h1>

{dados.map(f=>(
<div key={f.id}>
{f.nome}
</div>
))}

</div>

)

}
